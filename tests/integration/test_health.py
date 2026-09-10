import pytest
from unittest.mock import patch, AsyncMock

from app.models.harness import HarnessModel

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_health_returns_ok_and_harnesses(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "service" in data
    assert "harnesses" in data
    # should have 18 harnesses after expansion (4 original + agy/pi + 12 generic)
    from app.harnesses.registry import all_adapters

    assert len(data["harnesses"]) == len(all_adapters())
    names = {h["name"] for h in data["harnesses"]}
    assert "opencode" in names
    assert "claude" in names
    assert "agy" in names
    assert "pi" in names
    # each should have installed flag
    for h in data["harnesses"]:
        assert "installed" in h
        assert isinstance(h["installed"], bool)


@pytest.mark.asyncio
async def test_health_is_fast(client):
    import time
    start = time.monotonic()
    resp = await client.get("/health")
    elapsed = time.monotonic() - start
    assert resp.status_code == 200
    # should be fast (<500ms)
    assert elapsed < 0.5


@pytest.mark.asyncio
async def test_harness_health_returns_installed_flag(client, user_headers):
    # mock is_installed false
    with patch("app.api.admin.get_adapter") as mock_get:
        mock_adapter = patch.object
        # create a mock adapter
        from unittest.mock import MagicMock
        adapter = MagicMock()
        adapter.name = "opencode"
        adapter.display_name = "OpenCode"
        adapter.executable = "opencode"
        adapter.provider = "opencode"
        adapter.is_installed.return_value = False
        adapter.list_models = AsyncMock(return_value=[])
        mock_get.return_value = adapter

        resp = await client.get("/api/admin/harnesses/opencode/health", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["installed"] is False
        assert "latency_ms" in data
        assert "models" in data
        assert data["models"] == 0

    # mock installed true with models
    with patch("app.api.admin.get_adapter") as mock_get:
        from unittest.mock import MagicMock
        adapter = MagicMock()
        adapter.name = "opencode"
        adapter.display_name = "OpenCode"
        adapter.executable = "opencode"
        adapter.provider = "opencode"
        adapter.is_installed.return_value = True
        adapter.list_models = AsyncMock(return_value=[HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="big-pickle")])
        mock_get.return_value = adapter

        resp2 = await client.get("/api/admin/harnesses/opencode/health", headers=user_headers)
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2["installed"] is True
        assert data2["models"] == 1
        assert data2["latency_ms"] >= 0


@pytest.mark.asyncio
async def test_harness_health_unknown_returns_404(client, user_headers):
    resp = await client.get("/api/admin/harnesses/unknown/health", headers=user_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_harnesses_list_includes_last_checked_at(client, user_headers):
    # call health to update last_checked_at, then list
    await client.get("/api/admin/harnesses/opencode/health", headers=user_headers)
    resp = await client.get("/api/admin/harnesses", headers=user_headers)
    assert resp.status_code == 200
    data = resp.json()
    for h in data:
        # last_checked_at may be None initially, but after health it should be set for that harness
        assert "last_checked_at" in h


@pytest.mark.asyncio
async def test_refresh_updates_health(client, admin_headers):
    # refresh should update model cache and be fast
    resp = await client.post("/api/admin/harnesses/refresh", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "refreshed"
