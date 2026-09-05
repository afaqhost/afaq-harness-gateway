import pytest
from unittest.mock import patch

from app.clients.registry import MODEL_CACHE
from app.models.harness import HarnessModel
pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    MODEL_CACHE["commandcode"] = [HarnessModel(id="commandcode//deepseek/deepseek-v4-flash", harness="commandcode", provider="deepseek", name="deepseek/deepseek-v4-flash")]
    yield
    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_create_and_list_conversations(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"title": "My chat", "model": "opencode//opencode/big-pickle"})
    assert resp.status_code == 200
    conv_id = resp.json()["id"]

    resp2 = await client.get("/api/chat/conversations", headers=user_headers)
    assert resp2.status_code == 200
    data = resp2.json()
    assert any(c["id"] == conv_id for c in data)


@pytest.mark.asyncio
async def test_conversation_isolation_between_users(client, db_session, admin_headers, user_headers):
    # admin creates conversation
    resp = await client.post("/api/chat/conversations", headers=admin_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    # regular user cannot fetch admin's conversation
    resp2 = await client.get(f"/api/chat/conversations/{conv_id}", headers=user_headers)
    assert resp2.status_code == 404


@pytest.mark.asyncio
async def test_send_message_persists_and_returns_assistant_reply(client, user_headers):
    # create conversation
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    # mock adapter.run to avoid subprocess
    from app.models.harness import HarnessResult

    async def fake_run(prompt, model=None, session_id=None, env=None, request_id=None):
        return HarnessResult(text="hello from fake harness", model=model or "default")

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        # also need to patch validate to accept our model
        resp2 = await client.post(f"/api/chat/conversations/{conv_id}/messages", headers=user_headers, json={"content": "hi there", "model": "opencode//opencode/big-pickle"})
        assert resp2.status_code == 200
        body = resp2.json()
        assert body["message"]["content"] == "hello from fake harness"
        assert "conversation" in body


@pytest.mark.asyncio
async def test_send_message_validates_model_and_returns_400_for_unknown(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    resp2 = await client.post(f"/api/chat/conversations/{conv_id}/messages", headers=user_headers, json={"content": "hello", "model": "opencode//nonexistent-model-xyz"})
    assert resp2.status_code == 400


@pytest.mark.asyncio
async def test_send_message_rejects_empty_and_too_long(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    empty = await client.post(f"/api/chat/conversations/{conv_id}/messages", headers=user_headers, json={"content": "   "})
    assert empty.status_code == 400

    long_content = "a" * 20001
    too_long = await client.post(f"/api/chat/conversations/{conv_id}/messages", headers=user_headers, json={"content": long_content})
    assert too_long.status_code == 400


@pytest.mark.asyncio
async def test_stream_message_sse_format(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    async def fake_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "hello ", {}
        yield "world", {}

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = fake_stream
        resp2 = await client.post(f"/api/chat/conversations/{conv_id}/messages/stream", headers=user_headers, json={"content": "stream test"})
        assert resp2.status_code == 200
        assert "text/event-stream" in resp2.headers["content-type"]
        body = resp2.text
        assert "data: " in body
        assert "[DONE]" in body


@pytest.mark.asyncio
async def test_openai_chat_completions_non_stream_with_api_key(client, db_session, api_key_headers):
    headers, raw_key = api_key_headers
    # Mock harness for openai endpoint as well
    from app.models.harness import HarnessResult

    async def fake_run(prompt, model=None, session_id=None, env=None, request_id=None):
        return HarnessResult(text="openai fake reply", model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        resp = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hello"}]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["choices"][0]["message"]["content"] == "openai fake reply"
        assert "usage" in data