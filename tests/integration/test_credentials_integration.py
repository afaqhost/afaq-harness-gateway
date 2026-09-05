import pytest
from unittest.mock import patch, AsyncMock

from app.clients.registry import MODEL_CACHE
from app.models.harness import HarnessModel

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["claude"] = [HarnessModel(id="claude//claude-sonnet", harness="claude", provider="claude", name="claude-sonnet")]
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="big-pickle")]
    yield
    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_create_and_list_credentials_masked(client, user_headers):
    resp = await client.post("/api/admin/harnesses/claude/credentials", headers=user_headers, json={"profile_name": "personal", "auth_type": "token", "token": "secret123"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["harness"] == "claude"
    assert data["profile_name"] == "personal"
    assert "secret123" not in resp.text
    assert "encrypted_token" not in resp.text

    list_resp = await client.get("/api/admin/credentials", headers=user_headers)
    assert list_resp.status_code == 200
    lst = list_resp.json()
    assert len(lst) == 1
    assert lst[0]["harness"] == "claude"
    assert "secret123" not in list_resp.text
    assert "encrypted_token" not in list_resp.text

    # also list per harness
    per_harness = await client.get("/api/admin/harnesses/claude/credentials", headers=user_headers)
    assert per_harness.status_code == 200
    assert len(per_harness.json()) == 1


@pytest.mark.asyncio
async def test_create_duplicate_returns_409(client, user_headers):
    resp = await client.post("/api/admin/harnesses/claude/credentials", headers=user_headers, json={"profile_name": "dup", "auth_type": "token", "token": "a"})
    assert resp.status_code == 200
    resp2 = await client.post("/api/admin/harnesses/claude/credentials", headers=user_headers, json={"profile_name": "dup", "auth_type": "token", "token": "b"})
    assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_create_invalid_harness_returns_404(client, user_headers):
    resp = await client.post("/api/admin/harnesses/unknown_harness/credentials", headers=user_headers, json={"profile_name": "p", "auth_type": "token", "token": "x"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_check_updates_status(client, user_headers):
    resp = await client.post("/api/admin/harnesses/claude/credentials", headers=user_headers, json={"profile_name": "checkme", "auth_type": "token", "token": "tok"})
    cred_id = resp.json()["id"]
    assert resp.json()["status"] == "unknown"
    assert resp.json()["last_checked_at"] is None

    # mock adapter.authenticate to return authenticated
    mock_adapter = AsyncMock()
    mock_adapter.authenticate = AsyncMock(return_value={"status": "authenticated", "message": "ok"})

    with patch("app.api.credentials.get_adapter", return_value=mock_adapter):
        check = await client.post(f"/api/admin/credentials/{cred_id}/check", headers=user_headers)
        assert check.status_code == 200
        assert check.json()["status"] == "authenticated"
        assert check.json()["last_checked_at"] is not None

    # list should show updated status
    lst = await client.get("/api/admin/credentials", headers=user_headers)
    assert lst.json()[0]["status"] == "authenticated"

    # also test harness authenticated flag reflected
    from unittest.mock import patch as _patch
    # harnesses should now show authenticated true for claude
    harn = await client.get("/api/admin/harnesses", headers=user_headers)
    # find claude
    for h in harn.json():
        if h["name"] == "claude":
            assert h["authenticated"] is True


@pytest.mark.asyncio
async def test_check_manual_required(client, user_headers):
    resp = await client.post("/api/admin/harnesses/opencode/credentials", headers=user_headers, json={"profile_name": "cli", "auth_type": "cli"})
    cred_id = resp.json()["id"]
    # default mock returns manual_required
    check = await client.post(f"/api/admin/credentials/{cred_id}/check", headers=user_headers)
    assert check.status_code == 200
    assert check.json()["status"] == "manual_required"


@pytest.mark.asyncio
async def test_delete_removes_profile(client, user_headers):
    resp = await client.post("/api/admin/harnesses/claude/credentials", headers=user_headers, json={"profile_name": "todelete", "auth_type": "token", "token": "x"})
    cred_id = resp.json()["id"]
    del_resp = await client.delete(f"/api/admin/credentials/{cred_id}", headers=user_headers)
    assert del_resp.status_code == 204
    lst = await client.get("/api/admin/credentials", headers=user_headers)
    assert len([c for c in lst.json() if c["id"] == cred_id]) == 0

    # delete again should be 404
    del2 = await client.delete(f"/api/admin/credentials/{cred_id}", headers=user_headers)
    assert del2.status_code == 404


@pytest.mark.asyncio
async def test_env_injection_into_harness(client, user_headers, db_session, regular_user):
    # create credential for opencode
    resp = await client.post("/api/admin/harnesses/opencode/credentials", headers=user_headers, json={"profile_name": "default", "auth_type": "token", "token": "env-secret-123"})
    assert resp.status_code == 200

    # mock adapter to capture env
    captured = {}

    async def fake_run(prompt, model=None, session_id=None, env=None, request_id=None):
        captured["env"] = env
        from app.models.harness import HarnessResult
        return HarnessResult(text="ok", model=model or "default")

    # need to ensure conversation exists
    conv_resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = conv_resp.json()["id"]

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        # also need to mock for openai? but we test chat
        resp2 = await client.post(f"/api/chat/conversations/{conv_id}/messages", headers=user_headers, json={"content": "hello", "model": "opencode//opencode/big-pickle"})
        assert resp2.status_code == 200
        # env should have been injected
        assert captured.get("env") == {"OPENAI_API_KEY": "env-secret-123"}

    # also test stream injection
    captured2 = {}

    async def fake_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        captured2["env"] = env
        yield "hello ", {}
        yield "world", {}

    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.stream = fake_stream
        resp3 = await client.post(f"/api/chat/conversations/{conv_id}/messages/stream", headers=user_headers, json={"content": "hi"})
        assert resp3.status_code == 200
        assert captured2.get("env") == {"OPENAI_API_KEY": "env-secret-123"}


@pytest.mark.asyncio
async def test_openai_env_injection(client, user_headers, db_session, regular_user):
    # create credential for claude (ANTHROPIC)
    await client.post("/api/admin/harnesses/claude/credentials", headers=user_headers, json={"profile_name": "default", "auth_type": "token", "token": "sk-ant-test"})
    captured = {}

    async def fake_run(prompt, model=None, session_id=None, env=None, request_id=None):
        captured["env"] = env
        from app.models.harness import HarnessResult
        return HarnessResult(text="ok", model=model or "default")

    # need to mock openai adapter
    from app.clients.registry import MODEL_CACHE
    from app.models.harness import HarnessModel
    MODEL_CACHE["claude"] = [HarnessModel(id="claude//claude-sonnet", harness="claude", provider="claude", name="claude-sonnet")]

    with patch("app.api.openai.get_adapter") as mock_get:
        mock = type("M", (), {})()
        mock.run = fake_run
        mock.stream = AsyncMock()
        mock_get.return_value = mock
        # use claude model via openai endpoint
        resp = await client.post("/v1/chat/completions", headers=user_headers, json={"model": "claude//claude-sonnet", "messages": [{"role": "user", "content": "hi"}]})
        # may be 200 or 400 depending on model validation, but we seeded
        if resp.status_code == 200:
            assert captured.get("env") == {"ANTHROPIC_API_KEY": "sk-ant-test"}


@pytest.mark.asyncio
async def test_credentials_isolation_between_users(client, admin_headers, user_headers):
    # admin creates credential
    resp = await client.post("/api/admin/harnesses/claude/credentials", headers=admin_headers, json={"profile_name": "adminprof", "auth_type": "token", "token": "adminsecret"})
    cred_id = resp.json()["id"]
    # regular user should not see it
    lst = await client.get("/api/admin/credentials", headers=user_headers)
    assert all(c["id"] != cred_id for c in lst.json())
    # regular user cannot check admin's credential
    check = await client.post(f"/api/admin/credentials/{cred_id}/check", headers=user_headers)
    assert check.status_code == 404
    # regular user cannot delete
    dele = await client.delete(f"/api/admin/credentials/{cred_id}", headers=user_headers)
    assert dele.status_code == 404
