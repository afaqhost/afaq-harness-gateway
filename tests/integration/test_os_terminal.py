"""Integration tests for the OS Terminal (admin PTY over WebSocket)."""

from __future__ import annotations

import asyncio
import json
import os
import sys

import pytest

from app.services.os_terminal import (
    OsTerminalService,
    TerminalError,
    os_terminal_service as _global_service,
)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def reset_service():
    """Each test starts with a clean session registry."""
    _global_service._sessions.clear()
    yield
    # best-effort cleanup
    async def _cleanup():
        for s in list(_global_service._sessions.values()):
            try:
                await _global_service.stop(s.terminal_id, s.user_id)
            except Exception:
                pass
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    if loop.is_running():
        return
    loop.run_until_complete(_cleanup())


# ---------- service tests (no FastAPI) ----------

@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX-only")
@pytest.mark.asyncio
async def test_service_starts_streams_and_stops():
    svc = OsTerminalService()
    s = await svc.start(user_id=1, shell="/bin/bash", cwd=".")
    assert s.pid > 0
    assert s.cols == 80 and s.rows == 24

    await svc.write(s.terminal_id, 1, b"echo hello-terminal-test\n")

    chunks: list[bytes] = []
    async for chunk in svc.stream(s.terminal_id, 1):
        chunks.append(chunk)
        joined = b"".join(chunks)
        if b"hello-terminal-test" in joined:
            break
        if b"exec failed" in joined:
            pytest.skip("execvp restricted in this sandbox")
    assert b"hello-terminal-test" in b"".join(chunks)

    ok = await svc.stop(s.terminal_id, user_id=1)
    assert ok is True
    assert svc.get(s.terminal_id, user_id=1) is None


@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX-only")
@pytest.mark.asyncio
async def test_service_isolates_users():
    svc = OsTerminalService()
    s = await svc.start(user_id=1, shell="/bin/bash", cwd=".")
    try:
        with pytest.raises(TerminalError):
            await svc.write(s.terminal_id, 999, b"x")
        with pytest.raises(TerminalError):
            await svc.resize(s.terminal_id, 999, 80, 24)
        # stream() raises before any chunk
        with pytest.raises(TerminalError):
            async for _ in svc.stream(s.terminal_id, 999):
                pass
    finally:
        await svc.stop(s.terminal_id, user_id=1)


@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX-only")
@pytest.mark.asyncio
async def test_service_resize_changes_winsize():
    svc = OsTerminalService()
    s = await svc.start(user_id=1, shell="/bin/bash", cwd=".")
    try:
        await svc.resize(s.terminal_id, 1, cols=120, rows=30)
        assert s.cols == 120 and s.rows == 30
        status = svc.status(s.terminal_id, user_id=1)
        assert status is not None
        assert status["cols"] == 120 and status["rows"] == 30
    finally:
        await svc.stop(s.terminal_id, user_id=1)


@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX-only")
@pytest.mark.asyncio
async def test_service_stop_is_idempotent():
    svc = OsTerminalService()
    s = await svc.start(user_id=1, shell="/bin/bash", cwd=".")
    assert await svc.stop(s.terminal_id, user_id=1) is True
    assert await svc.stop(s.terminal_id, user_id=1) is False


# ---------- API tests (FastAPI HTTPClient) ----------

@pytest.mark.asyncio
async def test_api_terminal_start_requires_admin(client, user_headers):
    resp = await client.post("/api/admin/terminal/start", headers=user_headers, json={})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_api_terminal_start_unauth_returns_403(client):
    # no auth header at all — admin_user dep returns 403
    resp = await client.post("/api/admin/terminal/start", json={})
    assert resp.status_code in (401, 403)


@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX-only")
@pytest.mark.asyncio
async def test_api_terminal_start_and_status_and_stop(client, admin_headers):
    # start
    resp = await client.post(
        "/api/admin/terminal/start", headers=admin_headers,
        json={"shell": "/bin/bash", "cwd": ".", "cols": 100, "rows": 30},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    terminal_id = body["terminal_id"]
    assert body["cols"] == 100 and body["rows"] == 30
    assert body["pid"] > 0
    assert body["shell"].endswith("bash")

    # status
    st = await client.get(f"/api/admin/terminal/{terminal_id}", headers=admin_headers)
    assert st.status_code == 200
    sbody = st.json()
    assert sbody["alive"] is True
    assert sbody["cols"] == 100 and sbody["rows"] == 30

    # stop
    sp = await client.post(f"/api/admin/terminal/{terminal_id}/stop", headers=admin_headers)
    assert sp.status_code == 204

    # status after stop -> 404
    st2 = await client.get(f"/api/admin/terminal/{terminal_id}", headers=admin_headers)
    assert st2.status_code == 404

    # cleanup the leaked session (if any)
    await client.post(f"/api/admin/terminal/{terminal_id}/stop", headers=admin_headers)


@pytest.mark.asyncio
async def test_api_terminal_status_404_for_unknown(client, admin_headers):
    resp = await client.get("/api/admin/terminal/does-not-exist", headers=admin_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_api_terminal_user_cannot_stop_admin_session(client, admin_headers, user_headers):
    # admin starts
    start = await client.post("/api/admin/terminal/start", headers=admin_headers, json={"shell": "/bin/bash"})
    if start.status_code != 200:
        pytest.skip(f"start failed: {start.text}")
    terminal_id = start.json()["terminal_id"]
    try:
        # regular user tries to stop it — admin_user dep should 403 before the
        # service-level isolation check. Either 403 (admin gate) or 404
        # (service-level hide) is acceptable.
        sp = await client.post(f"/api/admin/terminal/{terminal_id}/stop", headers=user_headers)
        assert sp.status_code in (403, 404), sp.text
    finally:
        await client.post(f"/api/admin/terminal/{terminal_id}/stop", headers=admin_headers)


# ---------- WebSocket smoke ----------

@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX-only")
@pytest.mark.asyncio
async def test_websocket_roundtrip(client, admin_headers, admin_user):
    """Open a WebSocket with query-param token, send a command, read back the echo."""
    from app.api.os_terminal import terminal_ws
    from starlette.websockets import WebSocket

    start = await client.post("/api/admin/terminal/start", headers=admin_headers, json={"shell": "/bin/bash"})
    assert start.status_code == 200
    terminal_id = start.json()["terminal_id"]

    token = admin_headers["Authorization"].split(" ", 1)[1]

    incoming = asyncio.Queue()
    await incoming.put({"type": "websocket.connect"})
    outgoing = []

    scope = {
        "type": "websocket",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "scheme": "ws",
        "path": f"/api/admin/terminal/{terminal_id}/ws",
        "raw_path": f"/api/admin/terminal/{terminal_id}/ws".encode(),
        "query_string": f"token={token}".encode(),
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "subprotocols": [],
    }

    async def receive():
        return await incoming.get()

    async def send(message):
        outgoing.append(message)
        if message["type"] == "websocket.accept":
            await incoming.put({"type": "websocket.receive", "text": "echo ws-roundtrip-test\n"})

    ws = WebSocket(scope, receive=receive, send=send)
    task = asyncio.create_task(terminal_ws(ws, terminal_id))

    found = False
    for _ in range(60):
        await asyncio.sleep(0.05)
        for msg in outgoing:
            if msg.get("type") == "websocket.send" and "ws-roundtrip-test" in msg.get("text", ""):
                found = True
                break
        if found:
            break

    await incoming.put({"type": "websocket.disconnect", "code": 1000})
    await task
    assert found, f"Did not see echo in outgoing messages: {outgoing}"


@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX-only")
@pytest.mark.asyncio
async def test_websocket_unauthenticated_rejected(client, admin_headers):
    """Verify WebSocket connection without token is closed with policy violation (code 1008)."""
    from app.api.os_terminal import terminal_ws
    from starlette.websockets import WebSocket

    start = await client.post("/api/admin/terminal/start", headers=admin_headers, json={"shell": "/bin/bash"})
    assert start.status_code == 200
    terminal_id = start.json()["terminal_id"]

    incoming = asyncio.Queue()
    await incoming.put({"type": "websocket.connect"})
    outgoing = []

    scope = {
        "type": "websocket",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "scheme": "ws",
        "path": f"/api/admin/terminal/{terminal_id}/ws",
        "raw_path": f"/api/admin/terminal/{terminal_id}/ws".encode(),
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "subprotocols": [],
    }

    async def receive():
        return await incoming.get()

    async def send(message):
        outgoing.append(message)

    ws = WebSocket(scope, receive=receive, send=send)
    await terminal_ws(ws, terminal_id)

    close_msgs = [m for m in outgoing if m.get("type") == "websocket.close"]
    assert len(close_msgs) == 1
    assert close_msgs[0].get("code") == 1008
