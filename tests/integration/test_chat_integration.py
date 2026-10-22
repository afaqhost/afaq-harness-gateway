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


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize(
    ("with_history", "title", "expected_title"),
    [(False, "Custom title", "current question"),
     (True, "Custom title", "Custom title"), (True, "New chat", "current question")],
)
async def test_message_preparation_reads_history_once_and_preserves_prompt(
    client, db_session, test_engine, user_headers, regular_user, fake_adapter, monkeypatch,
    stream, with_history, title, expected_title,
):
    from datetime import datetime, timedelta
    from sqlalchemy import event, select
    from app.clients.registry import ADAPTERS
    from app.core.config import settings
    from app.db.database import Conversation, Message
    from app.models.harness import HarnessResult

    monkeypatch.setattr(settings, "default_system_prompt", "Be helpful.")
    conversation = Conversation(user_id=regular_user.id, title=title, model="opencode//opencode/big-pickle")
    unrelated = Conversation(user_id=regular_user.id, title="Other", model=conversation.model)
    db_session.add_all([conversation, unrelated])
    await db_session.flush()
    db_session.add(Message(conversation_id=unrelated.id, role="user", content="unrelated question"))
    if with_history:
        earlier = datetime(2020, 1, 1)
        db_session.add_all([
            Message(conversation_id=conversation.id, role="user", content="earlier question", created_at=earlier),
            Message(conversation_id=conversation.id, role="assistant", content="earlier reply", created_at=earlier + timedelta(seconds=1)),
        ])
    await db_session.commit()

    message_reads = []
    prompts = []
    reads_before_dispatch = []

    def count_message_reads(conn, cursor, statement, parameters, context, executemany):
        normalized = " ".join(statement.lower().split())
        if normalized.startswith("select ") and "from messages" in normalized:
            message_reads.append(statement)

    async def fake_run(prompt, model=None, session_id=None, env=None, request_id=None):
        prompts.append(prompt)
        reads_before_dispatch.append(len(message_reads))
        return HarnessResult(text="new reply", model=model or "default")

    async def fake_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        await fake_run(prompt, model, session_id, env, request_id)
        yield "new reply", {}

    monkeypatch.setattr(fake_adapter, "run", fake_run)
    monkeypatch.setattr(fake_adapter, "stream", fake_stream)
    monkeypatch.setitem(ADAPTERS, "opencode", fake_adapter)
    event.listen(test_engine.sync_engine, "before_cursor_execute", count_message_reads)
    try:
        suffix = "/stream" if stream else ""
        response = await client.post(
            f"/api/chat/conversations/{conversation.id}/messages{suffix}",
            headers=user_headers, json={"content": "current question"},
        )
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", count_message_reads)

    assert response.status_code == 200
    if stream:
        assert "[DONE]" in response.text
    expected_prompt = "SYSTEM: Be helpful.\n\n"
    if with_history:
        expected_prompt += "user: earlier question\nassistant: earlier reply\n"
    assert prompts == [expected_prompt + "user: current question"]
    assert reads_before_dispatch == [1]
    await db_session.refresh(conversation)
    assert conversation.title == expected_title
    messages = (await db_session.scalars(
        select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at)
    )).all()
    assert [(message.role, message.content) for message in messages][-2:] == [
        ("user", "current question"), ("assistant", "new reply"),
    ]
