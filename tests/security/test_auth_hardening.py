import asyncio
import os
import pytest
import secrets
from unittest.mock import patch

from app.clients.registry import MODEL_CACHE
from app.core.config import Settings, settings, validate_production_secret, validate_production_settings
from app.core.security import create_access_token, generate_api_key, hash_password
from app.db.database import APIKey, User
from app.middleware.rate_limit import RateLimitMiddleware
from app.models.harness import HarnessModel, HarnessResult

pytestmark = pytest.mark.security


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [
        HarnessModel(
            id="opencode//opencode/big-pickle",
            harness="opencode",
            provider="opencode",
            name="opencode/big-pickle",
        )
    ]
    yield
    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_admin_api_key_cannot_reach_admin_endpoints_or_terminal_start(client, db_session, admin_user):
    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=admin_user.id, name="admin-key", key_prefix=prefix, key_hash=digest)
    db_session.add(key)
    await db_session.commit()
    headers = {"Authorization": f"Bearer {raw}"}

    resp_terminal = await client.post("/api/admin/terminal/start", headers=headers, json={})
    assert resp_terminal.status_code == 401

    resp_users = await client.get("/api/admin/users", headers=headers)
    assert resp_users.status_code == 401

    resp_keys = await client.get("/api/admin/keys", headers=headers)
    assert resp_keys.status_code == 401

    resp_creds = await client.get("/api/admin/credentials", headers=headers)
    assert resp_creds.status_code == 401

    resp_harness = await client.post("/api/admin/harnesses/opencode/install", headers=headers)
    assert resp_harness.status_code == 401

    resp_usage = await client.get("/api/chat/usage", headers=headers)
    assert resp_usage.status_code == 401

    resp_conv = await client.post("/api/chat/conversations", headers=headers, json={"model": "opencode//opencode/big-pickle"})
    assert resp_conv.status_code == 401


@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX-only")
@pytest.mark.asyncio
async def test_os_terminal_websocket_rejects_admin_api_key(client, admin_headers, admin_user, db_session):
    from app.api.os_terminal import terminal_ws
    from starlette.websockets import WebSocket

    start = await client.post("/api/admin/terminal/start", headers=admin_headers, json={"shell": "/bin/bash"})
    assert start.status_code == 200
    terminal_id = start.json()["terminal_id"]

    try:
        raw, prefix, digest = generate_api_key()
        key = APIKey(user_id=admin_user.id, name="admin-ws-key", key_prefix=prefix, key_hash=digest)
        db_session.add(key)
        await db_session.commit()

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
            "query_string": f"token={raw}".encode(),
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
    finally:
        await client.post(f"/api/admin/terminal/{terminal_id}/stop", headers=admin_headers)


def test_exact_example_placeholders_and_weak_secrets_rejected():
    env_secret = "replace-with-a-long-random-secret-generate-with-secrets-token_urlsafe"
    env_cred = "replace-with-a-long-random-encryption-secret-generate-with-secrets-token_urlsafe"

    with pytest.raises(RuntimeError, match="must not use example or known weak placeholder values"):
        validate_production_secret(env_secret, "SECRET_KEY")

    with pytest.raises(RuntimeError, match="must not use example or known weak placeholder values"):
        validate_production_secret(env_cred, "CREDENTIALS_KEY")

    with pytest.raises(RuntimeError, match="must be set to a strong random value"):
        validate_production_secret("", "SECRET_KEY")
    with pytest.raises(RuntimeError, match="must be set to a strong random value"):
        validate_production_secret("   ", "SECRET_KEY")

    with pytest.raises(RuntimeError, match="too short"):
        validate_production_secret("short-secret-under-32-chars", "SECRET_KEY")

    for weak in ["change-me-in-production", "change-me-in-production-32-byte-key", "replace-with-a-long-random-secret", "password"]:
        with pytest.raises(RuntimeError):
            validate_production_secret(weak, "SECRET_KEY")

    good_secret = secrets.token_urlsafe(48)
    good_cred = secrets.token_urlsafe(48)
    validate_production_secret(good_secret, "SECRET_KEY")
    validate_production_secret(good_cred, "CREDENTIALS_KEY")

    s = Settings(secret_key=good_secret, credentials_key=good_cred, debug=False)
    validate_production_settings(s)


def test_env_example_file_fails_in_production_mode():
    s = Settings(_env_file=".env.example", debug=False)
    with pytest.raises(RuntimeError):
        validate_production_settings(s)


@pytest.mark.asyncio
async def test_inactive_user_login_fails_without_jwt(client, db_session):
    pwd = "MySecretPassword123!"
    user = User(
        email="inactive@example.com",
        password_hash=hash_password(pwd),
        display_name="Inactive User",
        role="user",
        is_active=False,
    )
    db_session.add(user)
    await db_session.commit()

    resp = await client.post("/api/auth/login", data={"username": "inactive@example.com", "password": pwd})
    assert resp.status_code == 401
    data = resp.json()
    assert "access_token" not in data


def test_forwarded_ip_spoofing_ignored_by_default_honored_for_trusted_proxies():
    from starlette.requests import Request

    def make_request(client_ip: str, forwarded_for: str | None = None) -> Request:
        headers = []
        if forwarded_for:
            headers.append((b"x-forwarded-for", forwarded_for.encode()))
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/health",
            "headers": headers,
            "client": (client_ip, 12345),
        }
        return Request(scope)

    old_trusted = settings.trusted_proxies
    try:
        settings.trusted_proxies = ""
        req = make_request("192.168.1.50", "203.0.113.195")
        key = RateLimitMiddleware._bucket_key(req)
        assert key == "ip:192.168.1.50"

        settings.trusted_proxies = "192.168.1.50, 10.0.0.1"
        req_trusted = make_request("192.168.1.50", "203.0.113.195")
        key_trusted = RateLimitMiddleware._bucket_key(req_trusted)
        assert key_trusted == "ip:203.0.113.195"

        req_untrusted = make_request("192.168.1.51", "203.0.113.195")
        key_untrusted = RateLimitMiddleware._bucket_key(req_untrusted)
        assert key_untrusted == "ip:192.168.1.51"
    finally:
        settings.trusted_proxies = old_trusted


@pytest.mark.asyncio
async def test_openai_chat_completions_continues_accepting_api_key_and_jwt(client, db_session, regular_user, user_headers):
    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=regular_user.id, name="key-chat", key_prefix=prefix, key_hash=digest)
    db_session.add(key)
    await db_session.commit()
    api_key_headers = {"Authorization": f"Bearer {raw}"}

    async def fake_run(prompt, model=None, session_id=None, env=None, request_id=None):
        return HarnessResult(text="response from model", model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run

        resp_key = await client.post(
            "/v1/chat/completions",
            headers=api_key_headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hello"}]},
        )
        assert resp_key.status_code == 200

        resp_jwt = await client.post(
            "/v1/chat/completions",
            headers=user_headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hello"}]},
        )
        assert resp_jwt.status_code == 200


@pytest.mark.asyncio
async def test_sse_query_token_preserved_for_jwt(client, admin_user):
    token = create_access_token(str(admin_user.id))

    resp_me = await client.get(f"/api/auth/me?token={token}")
    assert resp_me.status_code == 401

    resp_keys = await client.get(f"/api/admin/keys?token={token}")
    assert resp_keys.status_code == 401

    resp_stream = await client.get(f"/api/admin/harnesses/opencode/jobs/nonexistent-job/stream?token={token}")
    assert resp_stream.status_code == 404
    assert resp_stream.json() == {"error": {"code": "not_found", "message": "Job not found"}}
