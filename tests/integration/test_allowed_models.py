import pytest
from unittest.mock import patch

from app.clients.registry import MODEL_CACHE
from app.core.security import generate_api_key
from app.db.database import APIKey
from app.models.harness import HarnessModel, HarnessResult

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    MODEL_CACHE["commandcode"] = [HarnessModel(id="commandcode//deepseek/deepseek-v4-flash", harness="commandcode", provider="deepseek", name="deepseek/deepseek-v4-flash")]
    yield
    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_allowed_models_allows_listed(client, db_session, regular_user):
    raw, prefix, digest = generate_api_key()
    key = APIKey(
        user_id=regular_user.id,
        name="allowed-key",
        key_prefix=prefix,
        key_hash=digest,
        allowed_models=["opencode//opencode/big-pickle"],
    )
    db_session.add(key)
    await db_session.commit()
    await db_session.refresh(key)
    headers = {"Authorization": f"Bearer {raw}"}

    async def fake_run(prompt, model=None, session_id=None, env=None):
        return HarnessResult(text="ok", model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        resp = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hello"}]},
        )
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_allowed_models_blocks_unlisted_returns_403(client, db_session, regular_user):
    raw, prefix, digest = generate_api_key()
    key = APIKey(
        user_id=regular_user.id,
        name="restricted-key",
        key_prefix=prefix,
        key_hash=digest,
        allowed_models=["opencode//opencode/big-pickle"],
    )
    db_session.add(key)
    await db_session.commit()
    await db_session.refresh(key)
    headers = {"Authorization": f"Bearer {raw}"}

    # also need to ensure get_adapter not called? But we patch.
    with patch("app.api.openai.get_adapter") as mock_get:
        # should not be called because allowed check happens before
        resp = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "commandcode//deepseek/deepseek-v4-flash", "messages": [{"role": "user", "content": "hello"}]},
        )
        assert resp.status_code == 403
        body = resp.json()
        # FastAPI wraps detail under "detail" key; support both shapes until S8 unified handler
        error = body.get("error") or body.get("detail", {}).get("error") or body.get("detail", {})
        assert error.get("code") == "model_forbidden" or "model_forbidden" in str(body)


@pytest.mark.asyncio
async def test_allowed_models_allows_prefix_wildcard(client, db_session, regular_user):
    raw, prefix, digest = generate_api_key()
    key = APIKey(
        user_id=regular_user.id,
        name="wildcard-key",
        key_prefix=prefix,
        key_hash=digest,
        allowed_models=["opencode/*"],
    )
    db_session.add(key)
    await db_session.commit()
    await db_session.refresh(key)
    headers = {"Authorization": f"Bearer {raw}"}

    async def fake_run(prompt, model=None, session_id=None, env=None):
        return HarnessResult(text="ok", model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        resp = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hello"}]},
        )
        assert resp.status_code == 200

        # different harness should be blocked
        resp2 = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "commandcode//deepseek/deepseek-v4-flash", "messages": [{"role": "user", "content": "hello"}]},
        )
        assert resp2.status_code == 403


@pytest.mark.asyncio
async def test_allowed_models_none_allows_any(client, db_session, regular_user):
    raw, prefix, digest = generate_api_key()
    key = APIKey(
        user_id=regular_user.id,
        name="open-key",
        key_prefix=prefix,
        key_hash=digest,
        allowed_models=None,
    )
    db_session.add(key)
    await db_session.commit()
    await db_session.refresh(key)
    headers = {"Authorization": f"Bearer {raw}"}

    async def fake_run(prompt, model=None, session_id=None, env=None):
        return HarnessResult(text="ok", model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        for model in ["opencode//opencode/big-pickle", "commandcode//deepseek/deepseek-v4-flash"]:
            resp = await client.post(
                "/v1/chat/completions",
                headers=headers,
                json={"model": model, "messages": [{"role": "user", "content": "hello"}]},
            )
            assert resp.status_code == 200, f"{model} should be allowed when allowed_models is None: {resp.text}"


@pytest.mark.asyncio
async def test_chat_send_message_allowed_models_enforced(client, db_session, regular_user):
    # also test via chat endpoint with API key
    raw, prefix, digest = generate_api_key()
    key = APIKey(
        user_id=regular_user.id,
        name="chat-restricted",
        key_prefix=prefix,
        key_hash=digest,
        allowed_models=["opencode//opencode/big-pickle"],
    )
    db_session.add(key)
    await db_session.commit()
    await db_session.refresh(key)
    headers = {"Authorization": f"Bearer {raw}"}

    # need to ensure current_user accepts API key (patched in auth)
    # create conversation via chat with API key
    resp = await client.post("/api/chat/conversations", headers=headers, json={"model": "opencode//opencode/big-pickle"})
    # if chat creation enforces allowed, should succeed for allowed model
    assert resp.status_code == 200
    conv_id = resp.json()["id"]

    # try sending message with disallowed model
    resp2 = await client.post(
        f"/api/chat/conversations/{conv_id}/messages",
        headers=headers,
        json={"content": "hello", "model": "commandcode//deepseek/deepseek-v4-flash"},
    )
    assert resp2.status_code == 403
