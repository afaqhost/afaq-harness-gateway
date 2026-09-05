import pytest
from unittest.mock import patch

from app.clients.registry import MODEL_CACHE
from app.models.harness import HarnessModel

pytestmark = pytest.mark.contract


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    yield
    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_sse_emits_event_and_id(client, user_headers):
    # create conv
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    async def fake_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "hello ", {}
        yield "world", {}

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = fake_stream
        resp2 = await client.post(f"/api/chat/conversations/{conv_id}/messages/stream", headers=user_headers, json={"content": "hi"})
        assert resp2.status_code == 200
        text = resp2.text
        # should contain event: token, id, retry
        assert "event: token" in text
        assert "id: " in text
        assert "retry: 3000" in text
        # start and usage and done
        assert "event: start" in text
        assert "event: usage" in text
        assert "event: done" in text
        assert "[DONE]" in text
        # each token should have data: with choices
        assert "data: " in text
        # ensure ids increment
        # find id lines
        lines = [l for l in text.splitlines() if l.startswith("id: ")]
        ids = [int(l.split(":")[1].strip()) for l in lines]
        assert ids == sorted(ids)
        assert len(ids) >= 2  # at least start + token ids


@pytest.mark.asyncio
async def test_sse_error_uses_event_error(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    async def failing_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "partial", {}
        raise RuntimeError("simulated harness failure")

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = failing_stream
        resp2 = await client.post(f"/api/chat/conversations/{conv_id}/messages/stream", headers=user_headers, json={"content": "hi"})
        assert resp2.status_code == 200
        text = resp2.text
        assert "event: error" in text or "event: token" in text
        # should contain error code harness_error
        assert "harness_error" in text or "error" in text.lower()


@pytest.mark.asyncio
async def test_openai_sse_emits_event_and_id(client, db_session, regular_user):
    from app.core.security import generate_api_key
    from app.db.database import APIKey

    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=regular_user.id, name="ssec", key_prefix=prefix, key_hash=digest)
    db_session.add(key)
    await db_session.commit()
    headers = {"Authorization": f"Bearer {raw}"}

    from unittest.mock import patch
    from app.models.harness import HarnessResult

    async def fake_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "tok1", {}
        yield "tok2", {}

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.stream = fake_stream
        # ensure model cached
        MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
        resp = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "stream": True},
        )
        assert resp.status_code == 200
        text = resp.text
        assert "event: token" in text
        assert "event: start" in text
        assert "event: done" in text
        assert "id: " in text


@pytest.mark.asyncio
async def test_sse_keepalive_header_present(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    async def quick_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "hi", {}

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = quick_stream
        resp2 = await client.post(f"/api/chat/conversations/{conv_id}/messages/stream", headers=user_headers, json={"content": "hi"})
        assert resp2.headers.get("X-Accel-Buffering") == "no"
        assert resp2.headers.get("Cache-Control") == "no-cache"
