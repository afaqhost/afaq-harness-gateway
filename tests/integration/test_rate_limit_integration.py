import pytest
from unittest.mock import patch
from sqlalchemy import select

from app.clients.registry import MODEL_CACHE
from app.core.security import generate_api_key
from app.db.database import APIKey
from app.models.harness import HarnessModel, HarnessResult

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    yield
    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_daily_limit_blocks_sixth_request(client, db_session, regular_user):
    # create key with daily_limit=5
    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=regular_user.id, name="quota-key", key_prefix=prefix, key_hash=digest, daily_limit=5)
    db_session.add(key)
    await db_session.commit()
    await db_session.refresh(key)
    headers = {"Authorization": f"Bearer {raw}"}

    async def fake_run(prompt, model=None, session_id=None, env=None):
        return HarnessResult(text="ok", model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        # 5 should succeed
        for i in range(5):
            resp = await client.post(
                "/v1/chat/completions",
                headers=headers,
                json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": f"hi {i}"}]},
            )
            assert resp.status_code == 200, f"request {i} failed: {resp.text}"

        # 6th should be 429
        resp = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hello"}]},
        )
        assert resp.status_code == 429
        data = resp.json()
        # error shape
        assert "error" in data or "detail" in data
        # check quota_exceeded code if using error structure
        body = data.get("error") or data.get("detail", {}).get("error") or {}
        # at least ensure detail contains quota or rate_limited
        assert resp.headers.get("Retry-After") is not None or "retry_after" in str(resp.text).lower() or "quota" in str(resp.text).lower()


@pytest.mark.asyncio
async def test_monthly_limit_blocks_third_request(client, db_session, regular_user):
    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=regular_user.id, name="monthly-key", key_prefix=prefix, key_hash=digest, monthly_limit=2)
    db_session.add(key)
    await db_session.commit()
    await db_session.refresh(key)
    headers = {"Authorization": f"Bearer {raw}"}

    async def fake_run(prompt, model=None, session_id=None, env=None):
        return HarnessResult(text="ok", model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        for i in range(2):
            resp = await client.post(
                "/v1/chat/completions",
                headers=headers,
                json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": f"hi {i}"}]},
            )
            assert resp.status_code == 200
        resp = await client.post(
            "/v1/chat/completions",
            headers=headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hello"}]},
        )
        assert resp.status_code == 429


@pytest.mark.asyncio
async def test_global_rate_limiter_blocks_after_burst(client, db_session, regular_user):
    # test global per-bucket limiter via middleware
    # use a unique auth token to isolate bucket
    from app.middleware.rate_limit import global_rate_limiter
    from app.core.config import settings

    # temporarily set low limit for this test
    old_limit = settings.rate_limit_per_minute
    old_enabled = settings.rate_limit_enabled
    settings.rate_limit_per_minute = 3
    settings.rate_limit_enabled = True
    # reset limiter
    global_rate_limiter.reset()
    try:
        # Use same Authorization header for all requests to hit same bucket
        raw, prefix, digest = generate_api_key()
        key = APIKey(user_id=regular_user.id, name="burst-key", key_prefix=prefix, key_hash=digest)
        db_session.add(key)
        await db_session.commit()
        await db_session.refresh(key)
        headers = {"Authorization": f"Bearer {raw}"}

        async def fake_run(prompt, model=None, session_id=None, env=None):
            return HarnessResult(text="ok", model=model or "default")

        with patch("app.api.openai.get_adapter") as mock_get:
            mock_get.return_value.run = fake_run
            # first 3 should succeed
            for i in range(3):
                resp = await client.post(
                    "/v1/chat/completions",
                    headers=headers,
                    json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": f"hi {i}"}]},
                )
                assert resp.status_code == 200, resp.text
            # 4th should be 429 from middleware
            resp = await client.post(
                "/v1/chat/completions",
                headers=headers,
                json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hello"}]},
            )
            assert resp.status_code == 429
            assert resp.headers.get("Retry-After") is not None
            body = resp.json()
            assert body["error"]["code"] == "rate_limited"
    finally:
        settings.rate_limit_per_minute = old_limit
        settings.rate_limit_enabled = old_enabled
        global_rate_limiter.reset()
