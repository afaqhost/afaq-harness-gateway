import pytest
import asyncio
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
async def test_list_pagination_returns_limited(client, user_headers):
    # create 25 conversations
    ids = []
    for i in range(25):
        resp = await client.post("/api/chat/conversations", headers=user_headers, json={"title": f"chat {i}", "model": "opencode//opencode/big-pickle"})
        assert resp.status_code == 200
        ids.append(resp.json()["id"])

    # first page limit 10
    resp = await client.get("/api/chat/conversations?limit=10&offset=0", headers=user_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 10

    # second page
    resp2 = await client.get("/api/chat/conversations?limit=10&offset=10", headers=user_headers)
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert len(data2) == 10
    # no overlap
    ids1 = {c["id"] for c in data}
    ids2 = {c["id"] for c in data2}
    assert ids1.isdisjoint(ids2)

    # third page should have 5 remaining
    resp3 = await client.get("/api/chat/conversations?limit=10&offset=20", headers=user_headers)
    assert len(resp3.json()) == 5

    # limit validation
    resp_bad = await client.get("/api/chat/conversations?limit=200", headers=user_headers)
    assert resp_bad.status_code == 422  # validation error le=100


@pytest.mark.asyncio
async def test_search_filters_by_title(client, user_headers):
    # create chats with distinct titles
    for title in ["hello", "world", "hello world", "foo bar"]:
        await client.post("/api/chat/conversations", headers=user_headers, json={"title": title, "model": "opencode//opencode/big-pickle"})

    resp = await client.get("/api/chat/conversations?q=hello", headers=user_headers)
    assert resp.status_code == 200
    data = resp.json()
    # should find 2: "hello" and "hello world"
    titles = [c["title"] for c in data]
    assert any("hello" == t for t in titles)
    assert any("hello world" == t for t in titles)
    assert len([t for t in titles if "hello" in t.lower()]) == 2

    # case insensitive?
    resp2 = await client.get("/api/chat/conversations?q=HELLO", headers=user_headers)
    assert len(resp2.json()) == 2

    # no match
    resp3 = await client.get("/api/chat/conversations?q=nonexistentxyz", headers=user_headers)
    assert len(resp3.json()) == 0


@pytest.mark.asyncio
async def test_archived_filter_hides_by_default(client, user_headers):
    # create one conv
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"title": "to archive", "model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]

    # archive it
    patch = await client.patch(f"/api/chat/conversations/{conv_id}", headers=user_headers, json={"archived": True})
    assert patch.status_code == 200
    assert patch.json()["archived"] is True

    # default list should not contain it
    lst = await client.get("/api/chat/conversations", headers=user_headers)
    ids = [c["id"] for c in lst.json()]
    assert conv_id not in ids

    # archived=true should contain it
    lst2 = await client.get("/api/chat/conversations?archived=true", headers=user_headers)
    ids2 = [c["id"] for c in lst2.json()]
    assert conv_id in ids2

    # unarchive
    patch2 = await client.patch(f"/api/chat/conversations/{conv_id}", headers=user_headers, json={"archived": False})
    assert patch2.json()["archived"] is False
    lst3 = await client.get("/api/chat/conversations", headers=user_headers)
    assert conv_id in [c["id"] for c in lst3.json()]


@pytest.mark.asyncio
async def test_pagination_with_search_and_archived_combined(client, user_headers):
    # create 5 archived with prefix test-
    for i in range(5):
        r = await client.post("/api/chat/conversations", headers=user_headers, json={"title": f"test-{i}", "model": "opencode//opencode/big-pickle"})
        cid = r.json()["id"]
        await client.patch(f"/api/chat/conversations/{cid}", headers=user_headers, json={"archived": True})

    # create 3 non-archived with same prefix
    for i in range(3):
        await client.post("/api/chat/conversations", headers=user_headers, json={"title": f"test-{10+i}", "model": "opencode//opencode/big-pickle"})

    # search test- with archived=false should get 3
    resp = await client.get("/api/chat/conversations?q=test-&archived=false", headers=user_headers)
    assert len(resp.json()) == 3

    # archived=true should get 5
    resp2 = await client.get("/api/chat/conversations?q=test-&archived=true", headers=user_headers)
    assert len(resp2.json()) == 5

    # pagination limit 2 on archived
    resp3 = await client.get("/api/chat/conversations?q=test-&archived=true&limit=2&offset=0", headers=user_headers)
    assert len(resp3.json()) == 2
    resp4 = await client.get("/api/chat/conversations?q=test-&archived=true&limit=2&offset=2", headers=user_headers)
    assert len(resp4.json()) == 2
