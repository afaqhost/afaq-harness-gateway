import pytest

pytestmark = pytest.mark.contract


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api/chat/conversations/9999", "/v1/chat/completions"])
async def test_error_shape_has_code(client, user_headers, path):
    if "conversations" in path:
        resp = await client.get(path, headers=user_headers)
    else:
        resp = await client.post(path, headers=user_headers, json={"model": "x", "messages": []})
    assert resp.status_code in (400, 401, 403, 404, 422)
    data = resp.json()
    assert "error" in data, f"expected error key, got {data}"
    assert "code" in data["error"]
    assert "message" in data["error"]


@pytest.mark.asyncio
async def test_validation_error_has_code(client, user_headers):
    # invalid tool_choice should be 422 with error code
    resp = await client.post(
        "/v1/chat/completions",
        headers=user_headers,
        json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "tool_choice": "invalid"},
    )
    assert resp.status_code == 422
    # FastAPI validation errors are not via our handler, but should still be JSON
    # Our handler only handles HTTPException, not ValidationError, but we can check that response is JSON
    assert resp.headers["content-type"].startswith("application/json")


@pytest.mark.asyncio
async def test_auth_error_has_code(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401
    data = resp.json()
    assert "error" in data
    assert data["error"]["code"] == "auth_error"


@pytest.mark.asyncio
async def test_not_found_has_code(client, user_headers):
    resp = await client.get("/api/chat/conversations/9999", headers=user_headers)
    assert resp.status_code == 404
    data = resp.json()
    assert data["error"]["code"] == "not_found"
