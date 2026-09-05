import pytest
from app.core.security import decrypt_secret, encrypt_secret
from app.services import credential_service

pytestmark = pytest.mark.unit


def test_encrypt_decrypt_roundtrip_via_service():
    # credential_service uses encrypt_secret directly, but we test the underlying
    secret = "my-super-secret"
    enc = encrypt_secret(secret)
    assert enc != secret
    assert decrypt_secret(enc) == secret


@pytest.mark.asyncio
async def test_create_profile_encrypts_not_plain(db_session, regular_user):
    # db_session is provided via conftest? Need to ensure we have fixture
    # This test uses db_session and regular_user from conftest
    profile = await credential_service.create_profile(db_session, regular_user.id, "claude", "personal", "token", "secret123")
    assert profile.encrypted_token != "secret123"
    assert "secret123" not in profile.encrypted_token
    # decrypt should equal original
    from app.core.security import decrypt_secret
    assert decrypt_secret(profile.encrypted_token) == "secret123"
    # check DB persisted
    fetched = await credential_service.get_profile(db_session, profile.id, regular_user.id)
    assert fetched is not None
    assert fetched.id == profile.id


@pytest.mark.asyncio
async def test_get_env_maps_harness_to_env_var(db_session, regular_user):
    # create profile for claude
    await credential_service.create_profile(db_session, regular_user.id, "claude", "default", "token", "sk-ant-123")
    env = await credential_service.get_env_for_harness(db_session, regular_user.id, "claude")
    assert env == {"ANTHROPIC_API_KEY": "sk-ant-123"}

    # commandcode
    await credential_service.create_profile(db_session, regular_user.id, "commandcode", "default", "token", "cmd-token-xyz")
    env2 = await credential_service.get_env_for_harness(db_session, regular_user.id, "commandcode")
    assert env2 == {"COMMAND_CODE_TOKEN": "cmd-token-xyz"}

    # cli auth type should return empty
    await credential_service.create_profile(db_session, regular_user.id, "opencode", "default", "cli", None)
    env3 = await credential_service.get_env_for_harness(db_session, regular_user.id, "opencode")
    assert env3 == {}

    # no profile returns empty
    env4 = await credential_service.get_env_for_harness(db_session, regular_user.id, "nonexistent")
    assert env4 == {}


@pytest.mark.asyncio
async def test_get_env_decrypt_failure_returns_empty(db_session, regular_user, monkeypatch):
    # create profile with valid token then corrupt encrypted_token
    prof = await credential_service.create_profile(db_session, regular_user.id, "claude", "default", "token", "valid")
    # corrupt
    prof.encrypted_token = "invalid-ciphertext"
    await db_session.commit()
    env = await credential_service.get_env_for_harness(db_session, regular_user.id, "claude")
    assert env == {}
