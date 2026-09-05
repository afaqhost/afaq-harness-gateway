import time

import pytest
from jose import jwt

from app.core.config import settings
from app.core.security import create_access_token, decrypt_secret, encrypt_secret, generate_api_key, hash_api_key, hash_password, verify_password
pytestmark = pytest.mark.unit


def test_hash_password_verify_roundtrip_succeeds():
    pwd = "CorrectHorseBatteryStaple123!"
    hashed = hash_password(pwd)
    assert hashed != pwd
    assert verify_password(pwd, hashed) is True


def test_verify_password_rejects_wrong_password():
    hashed = hash_password("right-password")
    assert verify_password("wrong-password", hashed) is False


def test_create_access_token_embeds_subject_and_expiry():
    token = create_access_token("42")
    payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    assert payload["sub"] == "42"
    assert "exp" in payload
    assert payload["exp"] > int(time.time())


def test_generate_api_key_produces_unique_hashed_prefix_triplet():
    raw1, prefix1, digest1 = generate_api_key()
    raw2, prefix2, digest2 = generate_api_key()
    assert raw1 != raw2
    assert raw1.startswith("afaq_")
    assert prefix1 == raw1[:14]
    assert digest1 == hash_api_key(raw1)
    assert digest2 == hash_api_key(raw2)


def test_hash_api_key_is_deterministic_sha256():
    assert hash_api_key("afaq_test") == hash_api_key("afaq_test")
    assert len(hash_api_key("anything")) == 64


def test_encrypt_decrypt_secret_roundtrip():
    secret = "my-super-secret-token-123"
    encrypted = encrypt_secret(secret)
    assert encrypted != secret
    assert decrypt_secret(encrypted) == secret


def test_encrypt_produces_different_ciphertext_for_same_plaintext():
    # Fernet includes random IV, so two encryptions differ but both decrypt correctly
    s = "same value"
    e1 = encrypt_secret(s)
    e2 = encrypt_secret(s)
    assert e1 != e2
    assert decrypt_secret(e1) == s
    assert decrypt_secret(e2) == s