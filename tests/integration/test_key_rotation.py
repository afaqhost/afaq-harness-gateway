import pytest
from unittest.mock import patch

from app.clients.registry import MODEL_CACHE
from app.models.harness import HarnessModel, HarnessResult

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_rotate_returns_new_key_and_old_fails(client, user_headers, db_session, regular_user):
    # create key
    resp = await client.post("/api/admin/keys", headers=user_headers, json={"name": "rotate-test"})
    assert resp.status_code == 200
    data = resp.json()
    old_key = data["key"]
    key_id = data["id"]
    old_headers = {"Authorization": f"Bearer {old_key}"}

    # verify old key works for openai (need to mock harness)
    from app.models.harness import HarnessResult
    async def fake_run(prompt, model=None, session_id=None, env=None, request_id=None):
        return HarnessResult(text="ok", model=model or "default")

    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="big-pickle")]
    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        # old key should work initially
        resp2 = await client.post("/v1/chat/completions", headers=old_headers, json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}]})
        assert resp2.status_code == 200

    # rotate
    rotate = await client.post(f"/api/admin/keys/{key_id}/rotate", headers=user_headers)
    assert rotate.status_code == 200
    new_data = rotate.json()
    assert "key" in new_data
    new_key = new_data["key"]
    assert new_key != old_key
    new_headers = {"Authorization": f"Bearer {new_key}"}

    # old key should now be 401
    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        old_resp = await client.post("/v1/chat/completions", headers=old_headers, json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}]})
        assert old_resp.status_code == 401

        # new key should work
        new_resp = await client.post("/v1/chat/completions", headers=new_headers, json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}]})
        assert new_resp.status_code == 200


@pytest.mark.asyncio
async def test_rotate_not_found_returns_404(client, user_headers):
    resp = await client.post("/api/admin/keys/99999/rotate", headers=user_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_rotate_isolation(client, admin_headers, user_headers):
    # user creates key
    resp = await client.post("/api/admin/keys", headers=user_headers, json={"name": "userkey"})
    key_id = resp.json()["id"]
    # admin tries to rotate user's key should be 404 (not found for admin)
    resp2 = await client.post(f"/api/admin/keys/{key_id}/rotate", headers=admin_headers)
    assert resp2.status_code == 404
