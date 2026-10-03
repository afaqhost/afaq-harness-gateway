import asyncio
import pytest
from unittest.mock import patch
from sqlalchemy import select

from app.clients.registry import MODEL_CACHE
from app.db.database import Message
from app.models.harness import HarnessModel
from app.services.process_registry import process_registry

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    yield
    MODEL_CACHE.clear()


@pytest.fixture(autouse=True)
def isolate_in_memory_history():
    """Deterministically isolate history store to in-memory fallback for all SSE tests.

    Ensures tests do not depend on a locally running Redis service or on .env
    enabling Redis, and restores global state afterward.
    """
    import app.transport.history as th
    from app.services.process_registry import process_registry
    from app.transport.history import HistoryStore

    orig_history_store = th.history_store
    orig_registry_history = process_registry._history

    mem_store = HistoryStore()
    th.history_store = mem_store
    process_registry._history = mem_store

    try:
        yield mem_store
    finally:
        th.history_store = orig_history_store
        process_registry._history = orig_registry_history


import pytest_asyncio


@pytest_asyncio.fixture(autouse=True)
async def clear_history():
    await process_registry.clear()
    yield
    await process_registry.clear()


@pytest.mark.asyncio
async def test_reconnect_replays_from_last_id(client, user_headers, db_session):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    async def three_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "a", {}
        yield "b", {}
        yield "c", {}

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = three_stream
        first = await client.post(f"/api/chat/conversations/{conv_id}/messages/stream", headers=user_headers, json={"content": "hello"})
        assert first.status_code == 200
        stream_id = first.headers.get("X-Stream-ID")
        assert stream_id is not None
        text1 = first.text
        ids = []
        for line in text1.splitlines():
            if line.startswith("id: "):
                try:
                    ids.append(int(line.split(":")[1].strip()))
                except ValueError:
                    pass
        assert len(ids) >= 3

        second_id = ids[1] if len(ids) > 1 else 2

        # Verify DB messages count before reconnect
        msgs_before = (await db_session.execute(select(Message).where(Message.conversation_id == conv_id))).scalars().all()
        count_before = len(msgs_before)

        # Mock adapter on reconnect to assert it is never invoked
        stream_called = False

        async def unexpected_stream(*args, **kwargs):
            nonlocal stream_called
            stream_called = True
            yield "should_not_happen", {}

        with patch("app.api.chat.get_adapter") as mock_reconnect:
            mock_reconnect.return_value.stream = unexpected_stream
            second = await client.post(
                f"/api/chat/conversations/{conv_id}/messages/stream",
                headers={**user_headers, "X-Stream-ID": stream_id, "Last-Event-ID": str(second_id)},
                json={"content": "hello again"},
            )

        assert second.status_code == 200
        assert not stream_called, "Harness adapter stream must not be invoked on reconnect"

        # Assert no new Message row was written
        msgs_after = (await db_session.execute(select(Message).where(Message.conversation_id == conv_id))).scalars().all()
        assert len(msgs_after) == count_before, "No new Message row must be written on reconnect"

        assert second.headers.get("X-Stream-ID") == stream_id
        text2 = second.text
        replayed_ids = [int(l.split(":")[1].strip()) for l in text2.splitlines() if l.startswith("id: ")]
        assert all(rid > second_id for rid in replayed_ids)
        assert replayed_ids == sorted(replayed_ids)
        assert "event: token" in text2


@pytest.mark.asyncio
async def test_reconnect_openai(client, db_session, regular_user):
    from app.core.security import generate_api_key
    from app.db.database import APIKey

    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=regular_user.id, name="k", key_prefix=prefix, key_hash=digest)
    db_session.add(key)
    await db_session.commit()
    headers = {"Authorization": f"Bearer {raw}"}

    async def stream(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "x", {}
        yield "y", {}

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.stream = stream
        first = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "stream": True},
        )
        assert first.status_code == 200
        stream_id = first.headers.get("X-Stream-ID")
        assert stream_id is not None
        assert "event: token" in first.text
        ids = [int(l.split(":")[1].strip()) for l in first.text.splitlines() if l.startswith("id: ")]
        last = ids[0] if ids else 1

        second = await client.post(
            "/v1/chat/completions",
            headers={**headers, "X-Stream-ID": stream_id, "Last-Event-ID": str(last)},
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "stream": True},
        )
        assert second.status_code == 200
        assert second.headers.get("X-Stream-ID") == stream_id
        assert "event: token" in second.text
        replayed_ids = [int(l.split(":")[1].strip()) for l in second.text.splitlines() if l.startswith("id: ")]
        assert all(rid > last for rid in replayed_ids)
        assert replayed_ids == sorted(replayed_ids)


@pytest.mark.asyncio
async def test_last_event_id_without_stream_id_rejected_before_side_effects(client, user_headers, db_session):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    msgs_before = (await db_session.execute(select(Message).where(Message.conversation_id == conv_id))).scalars().all()
    count_before = len(msgs_before)

    # Calling with Last-Event-ID but missing X-Stream-ID
    bad_resp = await client.post(
        f"/api/chat/conversations/{conv_id}/messages/stream",
        headers={**user_headers, "Last-Event-ID": "2"},
        json={"content": "should be rejected"},
    )
    assert bad_resp.status_code == 400
    err = bad_resp.json()
    assert err["error"]["code"] in ("missing_stream_id", "validation_error")

    # Verify no message was inserted into the database
    msgs_after = (await db_session.execute(select(Message).where(Message.conversation_id == conv_id))).scalars().all()
    assert len(msgs_after) == count_before

    # Also test OpenAI endpoint
    bad_openai = await client.post(
        "/v1/chat/completions",
        headers={**user_headers, "Last-Event-ID": "2"},
        json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "stream": True},
    )
    assert bad_openai.status_code == 400
    err_openai = bad_openai.json()
    assert err_openai["error"]["code"] in ("missing_stream_id", "validation_error")


@pytest.mark.asyncio
async def test_invalid_and_reused_stream_ids_rejected(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    # Invalid characters in stream id
    bad_id_resp = await client.post(
        f"/api/chat/conversations/{conv_id}/messages/stream",
        headers={**user_headers, "X-Stream-ID": "invalid:with:colons"},
        json={"content": "hello"},
    )
    assert bad_id_resp.status_code == 400

    # Oversized stream id (> 128 chars)
    long_id_resp = await client.post(
        f"/api/chat/conversations/{conv_id}/messages/stream",
        headers={**user_headers, "X-Stream-ID": "a" * 129},
        json={"content": "hello"},
    )
    assert long_id_resp.status_code == 400

    # Start valid stream with custom stream id
    custom_sid = "test-custom-stream-1"
    async def quick_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "tok", {}

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = quick_stream
        first = await client.post(
            f"/api/chat/conversations/{conv_id}/messages/stream",
            headers={**user_headers, "X-Stream-ID": custom_sid},
            json={"content": "hello"},
        )
        assert first.status_code == 200
        assert first.headers.get("X-Stream-ID") == custom_sid

    # Reusing the existing stream id without Last-Event-ID must be rejected with 409
    reused_resp = await client.post(
        f"/api/chat/conversations/{conv_id}/messages/stream",
        headers={**user_headers, "X-Stream-ID": custom_sid},
        json={"content": "second try"},
    )
    assert reused_resp.status_code == 409
    err = reused_resp.json()
    assert err["error"]["code"] in ("stream_id_conflict", "conflict")


@pytest.mark.asyncio
async def test_two_openai_streams_same_user_do_not_collide(client, db_session, regular_user):
    from app.core.security import generate_api_key
    from app.db.database import APIKey

    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=regular_user.id, name="k", key_prefix=prefix, key_hash=digest)
    db_session.add(key)
    await db_session.commit()
    headers = {"Authorization": f"Bearer {raw}"}

    async def stream_a(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "alpha", {}

    async def stream_b(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "beta", {}

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.stream = stream_a
        resp_a = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "prompt A"}], "stream": True},
        )
        assert resp_a.status_code == 200
        sid_a = resp_a.headers["X-Stream-ID"]
        assert "alpha" in resp_a.text

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.stream = stream_b
        resp_b = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "prompt B"}], "stream": True},
        )
        assert resp_b.status_code == 200
        sid_b = resp_b.headers["X-Stream-ID"]
        assert "beta" in resp_b.text

    # Stream IDs must be distinct
    assert sid_a != sid_b

    # Reconnect to stream A replays only A's tokens, not B's
    recon_a = await client.post(
        "/v1/chat/completions",
        headers={**headers, "X-Stream-ID": sid_a, "Last-Event-ID": "1"},
        json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "prompt A"}], "stream": True},
    )
    assert recon_a.status_code == 200
    assert "alpha" in recon_a.text
    assert "beta" not in recon_a.text

    # Reconnect to stream B replays only B's tokens, not A's
    recon_b = await client.post(
        "/v1/chat/completions",
        headers={**headers, "X-Stream-ID": sid_b, "Last-Event-ID": "1"},
        json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "prompt B"}], "stream": True},
    )
    assert recon_b.status_code == 200
    assert "beta" in recon_b.text
    assert "alpha" not in recon_b.text


@pytest.mark.asyncio
async def test_two_streams_in_same_conversation_do_not_collide(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    async def stream_1(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "token-one", {}

    async def stream_2(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "token-two", {}

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = stream_1
        first = await client.post(
            f"/api/chat/conversations/{conv_id}/messages/stream",
            headers=user_headers,
            json={"content": "msg 1"},
        )
        assert first.status_code == 200
        sid_1 = first.headers["X-Stream-ID"]
        assert "token-one" in first.text

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = stream_2
        second = await client.post(
            f"/api/chat/conversations/{conv_id}/messages/stream",
            headers=user_headers,
            json={"content": "msg 2"},
        )
        assert second.status_code == 200
        sid_2 = second.headers["X-Stream-ID"]
        assert "token-two" in second.text

    assert sid_1 != sid_2

    # Reconnecting to stream 1 must NOT replay stream 2's events
    recon_1 = await client.post(
        f"/api/chat/conversations/{conv_id}/messages/stream",
        headers={**user_headers, "X-Stream-ID": sid_1, "Last-Event-ID": "1"},
        json={"content": "msg 1"},
    )
    assert recon_1.status_code == 200
    assert "token-one" in recon_1.text
    assert "token-two" not in recon_1.text

    # Reconnecting to stream 2 must NOT replay stream 1's events
    recon_2 = await client.post(
        f"/api/chat/conversations/{conv_id}/messages/stream",
        headers={**user_headers, "X-Stream-ID": sid_2, "Last-Event-ID": "1"},
        json={"content": "msg 2"},
    )
    assert recon_2.status_code == 200
    assert "token-two" in recon_2.text
    assert "token-one" not in recon_2.text


@pytest.mark.asyncio
async def test_reconnect_replays_only_greater_ids_in_order(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    async def multi_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        for ch in ["t1", "t2", "t3", "t4", "t5"]:
            yield ch, {}

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = multi_stream
        first = await client.post(
            f"/api/chat/conversations/{conv_id}/messages/stream",
            headers=user_headers,
            json={"content": "multi"},
        )
        assert first.status_code == 200
        sid = first.headers["X-Stream-ID"]
        all_ids = [int(l.split(":")[1].strip()) for l in first.text.splitlines() if l.startswith("id: ")]
        assert len(all_ids) >= 7  # start + 5 tokens + usage + done

        # Reconnect with a midpoint Last-Event-ID
        cutoff_idx = 3
        cutoff_id = all_ids[cutoff_idx]
        recon = await client.post(
            f"/api/chat/conversations/{conv_id}/messages/stream",
            headers={**user_headers, "X-Stream-ID": sid, "Last-Event-ID": str(cutoff_id)},
            json={"content": "multi"},
        )
        assert recon.status_code == 200
        replayed_ids = [int(l.split(":")[1].strip()) for l in recon.text.splitlines() if l.startswith("id: ")]
        expected_ids = all_ids[cutoff_idx + 1 :]
        assert replayed_ids == expected_ids
        assert all(rid > cutoff_id for rid in replayed_ids)
        assert replayed_ids == sorted(replayed_ids)


@pytest.mark.asyncio
async def test_in_memory_fallback_writer_and_reader_share_state(client, user_headers):
    """Regression test: verify writer and reconnect reader share state under in-memory fallback.

    If ProcessRegistry._history and the controller reconnect reader were separate
    in-memory HistoryStore instances, store_and_format_sse would write to one instance,
    and resolve_stream_identity / replay would check the other, causing a 404 stream_not_found.
    """
    import app.transport.history as th
    from app.services.process_registry import process_registry
    from app.transport.history import HistoryStore

    # Explicitly verify both references point to the exact same in-memory store instance
    assert isinstance(process_registry._history, HistoryStore)
    assert process_registry._history is th.history_store

    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    sid = "mem-test-stream-42"

    async def sample_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "alpha", {}
        yield "beta", {}

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = sample_stream
        first = await client.post(
            f"/api/chat/conversations/{conv_id}/messages/stream",
            headers={**user_headers, "X-Stream-ID": sid},
            json={"content": "hello in memory"},
        )
        assert first.status_code == 200
        assert first.headers.get("X-Stream-ID") == sid

    user_info = (await client.get("/api/auth/me", headers=user_headers)).json()
    expected_key = f"conv:{user_info['id']}:{conv_id}:{sid}"
    assert await process_registry.has_history(expected_key), "Writer must have populated history for the key"

    # Reconnect must find the history and succeed with 200 (not 404) and replay events
    recon = await client.post(
        f"/api/chat/conversations/{conv_id}/messages/stream",
        headers={**user_headers, "X-Stream-ID": sid, "Last-Event-ID": "1"},
        json={"content": "reconnect"},
    )
    assert recon.status_code == 200
    assert recon.headers.get("X-Stream-ID") == sid
    assert "event: token" in recon.text
    replayed = await process_registry.get_replay(expected_key, 1)
    assert len(replayed) > 0


@pytest.mark.asyncio
async def test_openai_non_stream_with_stream_headers_rejected(client, user_headers):
    """X-Stream-ID and Last-Event-ID are SSE-only on POST /v1/chat/completions.

    If either is supplied while stream=false, the gateway must return HTTP 400
    with a structured error rather than silently ignoring or validating it.
    """
    payload = {
        "model": "opencode//opencode/big-pickle",
        "messages": [{"role": "user", "content": "hello"}],
        "stream": False,
    }

    # 1. Non-stream with X-Stream-ID only -> 400
    resp_sid = await client.post(
        "/v1/chat/completions",
        headers={**user_headers, "X-Stream-ID": "test-stream-id"},
        json=payload,
    )
    assert resp_sid.status_code == 400
    err_sid = resp_sid.json()
    assert err_sid["error"]["code"] == "invalid_request_error"
    assert "stream=true" in err_sid["error"]["message"]

    # 2. Non-stream with Last-Event-ID only -> 400
    resp_last = await client.post(
        "/v1/chat/completions",
        headers={**user_headers, "Last-Event-ID": "1"},
        json=payload,
    )
    assert resp_last.status_code == 400
    err_last = resp_last.json()
    assert err_last["error"]["code"] == "invalid_request_error"
    assert "stream=true" in err_last["error"]["message"]

    # 3. Non-stream with both headers -> 400
    resp_both = await client.post(
        "/v1/chat/completions",
        headers={**user_headers, "X-Stream-ID": "test-stream-id", "Last-Event-ID": "1"},
        json=payload,
    )
    assert resp_both.status_code == 400
    err_both = resp_both.json()
    assert err_both["error"]["code"] == "invalid_request_error"

    # 4. Non-stream without stream headers should NOT be rejected with 400 invalid_request_error
    from app.models.harness import HarnessResult
    async def fake_run(*args, **kwargs):
        return HarnessResult(text="response text", model="opencode/big-pickle")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        resp_valid = await client.post(
            "/v1/chat/completions",
            headers=user_headers,
            json=payload,
        )
        assert resp_valid.status_code == 200
        assert resp_valid.json()["choices"][0]["message"]["content"] == "response text"
