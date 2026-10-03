import pytest
from httpx import AsyncClient

from app.core.security import hash_password
from app.db.database import (
    APIKey,
    Conversation,
    CredentialProfile,
    Message,
    QuotaReservation,
    UsageRecord,
    User,
)

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


@pytest.mark.asyncio
async def test_login_rejects_oversize_password_with_validation_error(client, db_session):
    resp = await client.post("/api/auth/login", data={"username": "any@test.com", "password": "x" * 73})
    assert resp.status_code == 422
    data = resp.json()
    assert "error" in data or "detail" in data
    assert "72 bytes" in str(data)


@pytest.mark.asyncio
async def test_bootstrap_rejects_oversize_password_with_validation_error(client, db_session):
    # clear users to allow bootstrap
    from sqlalchemy import delete
    await db_session.execute(delete(User))
    await db_session.commit()

    resp = await client.post(
        "/api/auth/bootstrap",
        json={"email": "first_admin@test.com", "password": "a" * 80, "display_name": "Admin"},
    )
    assert resp.status_code == 422
    assert "72 bytes" in str(resp.json())


@pytest.mark.asyncio
async def test_admin_create_user_rejects_oversize_password_with_validation_error(client, admin_headers):
    resp = await client.post(
        "/api/admin/users",
        headers=admin_headers,
        json={"email": "oversize@test.com", "password": "b" * 75, "display_name": "Oversize", "role": "user"},
    )
    assert resp.status_code == 422
    assert "72 bytes" in str(resp.json())


@pytest.mark.asyncio
async def test_admin_user_crud_lifecycle(client, admin_headers):
    created = await client.post(
        "/api/admin/users",
        headers=admin_headers,
        json={
            "email": "Managed@Example.com",
            "password": "OriginalPass123!",
            "display_name": "Managed User",
            "role": "user",
        },
    )
    assert created.status_code == 200
    user_id = created.json()["id"]
    assert created.json()["email"] == "managed@example.com"
    assert created.json()["is_active"] is True

    updated = await client.patch(
        f"/api/admin/users/{user_id}",
        headers=admin_headers,
        json={
            "email": "updated@example.com",
            "password": "UpdatedPass123!",
            "display_name": "Updated User",
            "role": "admin",
            "is_active": False,
        },
    )
    assert updated.status_code == 200
    assert updated.json() == {
        "id": user_id,
        "email": "updated@example.com",
        "display_name": "Updated User",
        "role": "admin",
        "is_active": False,
    }

    inactive_login = await client.post(
        "/api/auth/login",
        data={"username": "updated@example.com", "password": "UpdatedPass123!"},
    )
    assert inactive_login.status_code == 401

    reactivated = await client.patch(
        f"/api/admin/users/{user_id}",
        headers=admin_headers,
        json={"is_active": True},
    )
    assert reactivated.status_code == 200

    users = await client.get("/api/admin/users", headers=admin_headers)
    assert users.status_code == 200
    assert any(user["id"] == user_id for user in users.json())

    deleted = await client.delete(f"/api/admin/users/{user_id}", headers=admin_headers)
    assert deleted.status_code == 204
    users_after_delete = await client.get("/api/admin/users", headers=admin_headers)
    assert all(user["id"] != user_id for user in users_after_delete.json())


@pytest.mark.asyncio
async def test_admin_user_crud_authorization_and_self_protection(
    client,
    admin_headers,
    user_headers,
    admin_user,
    regular_user,
):
    forbidden_update = await client.patch(
        f"/api/admin/users/{admin_user.id}",
        headers=user_headers,
        json={"display_name": "No access"},
    )
    forbidden_delete = await client.delete(
        f"/api/admin/users/{admin_user.id}",
        headers=user_headers,
    )
    assert forbidden_update.status_code == 403
    assert forbidden_delete.status_code == 403

    self_disable = await client.patch(
        f"/api/admin/users/{admin_user.id}",
        headers=admin_headers,
        json={"is_active": False},
    )
    self_demote = await client.patch(
        f"/api/admin/users/{admin_user.id}",
        headers=admin_headers,
        json={"role": "user"},
    )
    self_delete = await client.delete(
        f"/api/admin/users/{admin_user.id}",
        headers=admin_headers,
    )
    assert self_disable.status_code == 409
    assert self_demote.status_code == 409
    assert self_delete.status_code == 409

    duplicate_email = await client.patch(
        f"/api/admin/users/{regular_user.id}",
        headers=admin_headers,
        json={"email": admin_user.email.upper()},
    )
    assert duplicate_email.status_code == 409


@pytest.mark.asyncio
async def test_admin_delete_user_removes_owned_records(
    client,
    db_session,
    admin_headers,
    regular_user,
):
    api_key = APIKey(
        user_id=regular_user.id,
        name="owned-key",
        key_prefix="afaq_owned",
        key_hash="owned-key-hash",
    )
    conversation = Conversation(
        user_id=regular_user.id,
        title="Owned conversation",
        model="opencode//fake-model",
    )
    credential = CredentialProfile(
        user_id=regular_user.id,
        harness="opencode",
        profile_name="owned-profile",
    )
    db_session.add_all([api_key, conversation, credential])
    await db_session.flush()
    message = Message(
        conversation_id=conversation.id,
        role="user",
        content="Owned message",
    )
    usage = UsageRecord(
        user_id=regular_user.id,
        api_key_id=api_key.id,
        harness="opencode",
        model="fake-model",
    )
    reservation = QuotaReservation(
        token="owned-reservation",
        api_key_id=api_key.id,
        expires_at=regular_user.created_at,
    )
    db_session.add_all([message, usage, reservation])
    await db_session.commit()

    deleted = await client.delete(
        f"/api/admin/users/{regular_user.id}",
        headers=admin_headers,
    )
    assert deleted.status_code == 204
    assert await db_session.get(User, regular_user.id) is None
    assert await db_session.get(APIKey, api_key.id) is None
    assert await db_session.get(Conversation, conversation.id) is None
    assert await db_session.get(CredentialProfile, credential.id) is None
    assert await db_session.get(Message, message.id) is None
    assert await db_session.get(UsageRecord, usage.id) is None
    assert await db_session.get(QuotaReservation, reservation.id) is None
