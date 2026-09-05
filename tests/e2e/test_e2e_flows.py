import pytest
from unittest.mock import patch

from app.clients.registry import MODEL_CACHE
from app.models.harness import HarnessModel, HarnessResult
pytestmark = pytest.mark.e2e


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    yield
    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_e2e_bootstrap_login_create_chat_and_history(client):
    # bootstrap first admin
    resp = await client.post("/api/auth/bootstrap", json={"email": "e2e@test.com", "password": "StrongE2E123!", "display_name": "E2E"})
    assert resp.status_code == 200

    # login
    login = await client.post("/api/auth/login", data={"username": "e2e@test.com", "password": "StrongE2E123!"})
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # health
    health = await client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    # models list should contain seeded model
    models = await client.get("/v1/models")
    assert models.status_code == 200
    assert any(m["id"] == "opencode//opencode/big-pickle" for m in models.json()["data"])

    # create conversation
    conv = await client.post("/api/chat/conversations", headers=headers, json={"title": "E2E chat"})
    assert conv.status_code == 200
    conv_id = conv.json()["id"]

    # send two messages with mocked harness
    async def fake_run(prompt, model=None, session_id=None, env=None):
        return HarnessResult(text=f"reply to {prompt[:10]}", model=model or "default")

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        m1 = await client.post(f"/api/chat/conversations/{conv_id}/messages", headers=headers, json={"content": "hello"})
        assert m1.status_code == 200
        m2 = await client.post(f"/api/chat/conversations/{conv_id}/messages", headers=headers, json={"content": "how are you?"})
        assert m2.status_code == 200

    # fetch conversation detail should have 4 messages (2 user + 2 assistant)
    detail = await client.get(f"/api/chat/conversations/{conv_id}", headers=headers)
    assert detail.status_code == 200
    assert len(detail.json()["messages"]) == 4

    # patch title
    patched = await client.patch(f"/api/chat/conversations/{conv_id}", headers=headers, json={"title": "Renamed"})
    assert patched.status_code == 200
    assert patched.json()["title"] == "Renamed"

    # delete
    del_resp = await client.delete(f"/api/chat/conversations/{conv_id}", headers=headers)
    assert del_resp.status_code == 204

    # verify deleted
    gone = await client.get(f"/api/chat/conversations/{conv_id}", headers=headers)
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_e2e_api_key_flow_for_external_client(client, db_session):
    # bootstrap and login to create key
    await client.post("/api/auth/bootstrap", json={"email": "keyowner@test.com", "password": "Strong123!", "display_name": "Owner"})
    login = await client.post("/api/auth/login", data={"username": "keyowner@test.com", "password": "Strong123!"})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # create api key
    key_resp = await client.post("/api/admin/keys", headers=headers, json={"name": "ci-key"})
    assert key_resp.status_code == 200
    raw_key = key_resp.json()["key"]

    # external client uses api key to hit openai endpoint
    async def fake_run(prompt, model=None, session_id=None, env=None):
        return HarnessResult(text="external reply", model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        # patch model cache for openai validation bypass (no cache validation for openai currently)
        ext_headers = {"Authorization": f"Bearer {raw_key}"}
        comp = await client.post("/v1/chat/completions", headers=ext_headers, json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi external"}]})
        assert comp.status_code == 200
        assert comp.json()["choices"][0]["message"]["content"] == "external reply"


@pytest.mark.asyncio
async def test_e2e_conversation_stream_persists_messages(client, user_headers):
    # user_headers is from conftest regular_user
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    async def fake_stream(prompt, model=None, session_id=None, env=None):
        yield "streamed ", {}
        yield "content", {}

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = fake_stream
        stream_resp = await client.post(f"/api/chat/conversations/{conv_id}/messages/stream", headers=user_headers, json={"content": "stream me"})
        assert stream_resp.status_code == 200
        assert "[DONE]" in stream_resp.text

    # after stream, messages should be persisted
    detail = await client.get(f"/api/chat/conversations/{conv_id}", headers=user_headers)
    msgs = detail.json()["messages"]
    # at least 2 messages (user + assistant)
    assert len(msgs) >= 2
    assert any(m["role"] == "assistant" and "streamed content" in m["content"] for m in msgs)