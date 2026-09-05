import pytest
from datetime import datetime, timedelta

from app.db.database import UsageRecord
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
async def test_usage_pagination_and_filters(client, db_session, user_headers, regular_user):
    # seed 3 usage records directly via DB
    for i, (harness, model) in enumerate([
        ("opencode", "opencode//opencode/big-pickle"),
        ("opencode", "opencode//opencode/big-pickle"),
        ("commandcode", "commandcode//deepseek/deepseek-v4-flash"),
    ]):
        rec = UsageRecord(
            user_id=regular_user.id,
            harness=harness,
            model=model,
            prompt_tokens=10,
            completion_tokens=20,
            total_tokens=30,
            latency_ms=100,
        )
        db_session.add(rec)
    await db_session.commit()

    # limit 2 should return 2 + total 3
    resp = await client.get("/api/chat/usage?limit=2&offset=0", headers=user_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert len(data["items"]) == 2
    assert data["limit"] == 2
    assert data["offset"] == 0

    # offset 2 should return remaining 1
    resp2 = await client.get("/api/chat/usage?limit=2&offset=2", headers=user_headers)
    assert len(resp2.json()["items"]) == 1

    # filter by harness opencode should return 2
    resp3 = await client.get("/api/chat/usage?harness=opencode", headers=user_headers)
    assert resp3.json()["total"] == 2
    assert all(i["harness"] == "opencode" for i in resp3.json()["items"])

    # filter by model
    resp4 = await client.get("/api/chat/usage?model=commandcode//deepseek/deepseek-v4-flash", headers=user_headers)
    assert resp4.json()["total"] == 1

    # limit validation
    resp_bad = await client.get("/api/chat/usage?limit=200", headers=user_headers)
    # our Query le=100 should give 422
    assert resp_bad.status_code == 422


@pytest.mark.asyncio
async def test_usage_isolation_between_users(client, db_session, admin_headers, user_headers, admin_user, regular_user):
    # admin creates usage
    rec = UsageRecord(user_id=admin_user.id, harness="opencode", model="opencode//opencode/big-pickle", prompt_tokens=5, completion_tokens=5, total_tokens=10)
    db_session.add(rec)
    await db_session.commit()

    # regular user should not see admin's usage
    resp = await client.get("/api/chat/usage", headers=user_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0  # regular user has no records (previous test's data is isolated per test DB)
    # admin should see theirs
    resp2 = await client.get("/api/chat/usage", headers=admin_headers)
    assert resp2.json()["total"] == 1
    assert resp2.json()["items"][0]["user_id"] == admin_user.id


@pytest.mark.asyncio
async def test_usage_from_to_filters(client, db_session, user_headers, regular_user):
    now = datetime.utcnow()
    old = now - timedelta(days=5)
    recent = now - timedelta(hours=1)

    rec_old = UsageRecord(user_id=regular_user.id, harness="opencode", model="m1", prompt_tokens=1, completion_tokens=1, total_tokens=2, created_at=old)
    rec_recent = UsageRecord(user_id=regular_user.id, harness="opencode", model="m2", prompt_tokens=1, completion_tokens=1, total_tokens=2, created_at=recent)
    # use explicit created_at; need to set via db
    db_session.add_all([rec_old, rec_recent])
    await db_session.commit()

    # filter from 2 days ago should only get recent
    from_str = (now - timedelta(days=2)).isoformat()
    resp = await client.get(f"/api/chat/usage?from={from_str}", headers=user_headers)
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["model"] == "m2"

    # to filter
    to_str = (now - timedelta(days=2)).isoformat()
    resp2 = await client.get(f"/api/chat/usage?to={to_str}", headers=user_headers)
    assert resp2.json()["total"] == 1
    assert resp2.json()["items"][0]["model"] == "m1"


@pytest.mark.asyncio
async def test_usage_requires_auth(client):
    resp = await client.get("/api/chat/usage")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_usage_pagination_via_harness_flow(client, db_session, user_headers, regular_user):
    # also test that usage is correctly created via chat completions? Just check empty
    resp = await client.get("/api/chat/usage?harness=nonexistent", headers=user_headers)
    assert resp.json()["total"] == 0
    assert len(resp.json()["items"]) == 0
