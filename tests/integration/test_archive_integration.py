import pytest
from app.clients.registry import MODEL_CACHE
from app.models.harness import HarnessModel

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    yield
    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_archive_and_restore(client, user_headers):
    # create conv
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"title": "arch test", "model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]
    assert resp.json()["archived"] is False

    # archive
    patch = await client.patch(f"/api/chat/conversations/{conv_id}", headers=user_headers, json={"archived": True})
    assert patch.status_code == 200
    assert patch.json()["archived"] is True
    assert patch.json()["archived_at"] is not None

    # default list should hide
    lst = await client.get("/api/chat/conversations", headers=user_headers)
    assert conv_id not in [c["id"] for c in lst.json()]

    # archived=true should show
    lst2 = await client.get("/api/chat/conversations?archived=true", headers=user_headers)
    assert conv_id in [c["id"] for c in lst2.json()]

    # GET by id should still work even when archived? Our get_conversation_or_404 allows archived but not deleted
    get = await client.get(f"/api/chat/conversations/{conv_id}", headers=user_headers)
    assert get.status_code == 200
    assert get.json()["archived"] is True

    # unarchive via patch
    patch2 = await client.patch(f"/api/chat/conversations/{conv_id}", headers=user_headers, json={"archived": False})
    assert patch2.json()["archived"] is False
    assert patch2.json()["archived_at"] is None
    lst3 = await client.get("/api/chat/conversations", headers=user_headers)
    assert conv_id in [c["id"] for c in lst3.json()]


@pytest.mark.asyncio
async def test_soft_delete_and_restore(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"title": "delete test", "model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    # soft delete
    dele = await client.delete(f"/api/chat/conversations/{conv_id}", headers=user_headers)
    assert dele.status_code == 204

    # default list should not contain
    lst = await client.get("/api/chat/conversations", headers=user_headers)
    assert conv_id not in [c["id"] for c in lst.json()]
    # archived=true also should not contain because deleted is hidden
    lst2 = await client.get("/api/chat/conversations?archived=true", headers=user_headers)
    assert conv_id not in [c["id"] for c in lst2.json()]

    # GET should be 404
    get = await client.get(f"/api/chat/conversations/{conv_id}", headers=user_headers)
    assert get.status_code == 404

    # restore
    restore = await client.post(f"/api/chat/conversations/{conv_id}/restore", headers=user_headers)
    assert restore.status_code == 200
    assert restore.json()["deleted_at"] is None
    assert restore.json()["archived"] is False

    # now list should contain
    lst3 = await client.get("/api/chat/conversations", headers=user_headers)
    assert conv_id in [c["id"] for c in lst3.json()]
    get2 = await client.get(f"/api/chat/conversations/{conv_id}", headers=user_headers)
    assert get2.status_code == 200


@pytest.mark.asyncio
async def test_restore_not_deleted_returns_400(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"title": "not deleted", "model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]
    restore = await client.post(f"/api/chat/conversations/{conv_id}/restore", headers=user_headers)
    assert restore.status_code == 400


@pytest.mark.asyncio
async def test_delete_isolation(client, user_headers, admin_headers):
    # regular creates
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"title": "user conv", "model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    # admin cannot delete user's conv (should be 404)
    dele = await client.delete(f"/api/chat/conversations/{conv_id}", headers=admin_headers)
    assert dele.status_code == 404

    # admin cannot restore user's conv
    restore = await client.post(f"/api/chat/conversations/{conv_id}/restore", headers=admin_headers)
    assert restore.status_code == 404

    # user can still delete own
    dele2 = await client.delete(f"/api/chat/conversations/{conv_id}", headers=user_headers)
    assert dele2.status_code == 204


@pytest.mark.asyncio
async def test_archive_via_patch_persists(client, user_headers):
    # create and archive, then fetch
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"title": "persist", "model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]
    await client.patch(f"/api/chat/conversations/{conv_id}", headers=user_headers, json={"archived": True})
    # fetch detail
    get = await client.get(f"/api/chat/conversations/{conv_id}", headers=user_headers)
    assert get.json()["archived"] is True
    # ensure list archived filter works
    lst = await client.get("/api/chat/conversations?archived=true", headers=user_headers)
    assert any(c["id"] == conv_id for c in lst.json())
