import pytest
from httpx import AsyncClient

from app.core.security import hash_password
from app.db.database import User
pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_bootstrap_creates_first_admin_and_rejects_second(client, db_session):
    resp = await client.post("/api/auth/bootstrap", json={"email": "first@test.com", "password": "StrongPass123!", "display_name": "First"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "first@test.com"
    assert data["role"] == "admin"

    resp2 = await client.post("/api/auth/bootstrap", json={"email": "second@test.com", "password": "Another123!", "display_name": "Second"})
    assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_login_returns_jwt_and_user_payload(client, db_session):
    # seed user directly
    user = User(email="login@test.com", password_hash=hash_password("Secret123!"), display_name="Login", role="user")
    db_session.add(user)
    await db_session.commit()

    resp = await client.post("/api/auth/login", data={"username": "login@test.com", "password": "Secret123!"})
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "login@test.com"


@pytest.mark.asyncio
async def test_login_rejects_wrong_password(client, db_session):
    user = User(email="login2@test.com", password_hash=hash_password("Correct123!"), display_name="Login2")
    db_session.add(user)
    await db_session.commit()

    resp = await client.post("/api/auth/login", data={"username": "login2@test.com", "password": "Wrong123!"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_valid_jwt(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401

    resp2 = await client.get("/api/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
    assert resp2.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_current_user_when_authenticated(client, db_session, user_headers):
    resp = await client.get("/api/auth/me", headers=user_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == "user@test.com"


@pytest.mark.asyncio
async def test_admin_endpoints_require_admin_role(client, db_session, user_headers, admin_headers):
    # regular user cannot create another user via admin endpoint
    resp = await client.post("/api/admin/users", headers=user_headers, json={"email": "new@test.com", "password": "Pass123!", "display_name": "New", "role": "user"})
    assert resp.status_code == 403

    # admin can
    resp2 = await client.post("/api/admin/users", headers=admin_headers, json={"email": "new2@test.com", "password": "Pass123!", "display_name": "New2", "role": "user"})
    assert resp2.status_code == 200


@pytest.mark.asyncio
async def test_api_key_lifecycle_create_list_toggle_delete(client, db_session, user_headers):
    # create
    resp = await client.post("/api/admin/keys", headers=user_headers, json={"name": "my-key"})
    assert resp.status_code == 200
    key_data = resp.json()
    assert "key" in key_data
    assert key_data["key"].startswith("afaq_")
    key_id = key_data["id"]

    # list
    resp2 = await client.get("/api/admin/keys", headers=user_headers)
    assert resp2.status_code == 200
    assert any(k["id"] == key_id for k in resp2.json())

    # toggle
    resp3 = await client.patch(f"/api/admin/keys/{key_id}", headers=user_headers)
    assert resp3.status_code == 200
    assert resp3.json()["is_active"] is False

    # delete
    resp4 = await client.delete(f"/api/admin/keys/{key_id}", headers=user_headers)
    assert resp4.status_code == 204

    # verify deleted
    resp5 = await client.get("/api/admin/keys", headers=user_headers)
    assert all(k["id"] != key_id for k in resp5.json())