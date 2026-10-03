import hashlib
import secrets
from datetime import timedelta

from cryptography.fernet import Fernet
from jose import jwt
import bcrypt

from app.core.config import settings
from app.shared.time import utcnow

BCRYPT_MAX_PASSWORD_BYTES = 72
ALGORITHM = "HS256"

def hash_password(password: str) -> str:
    pwd_bytes = password.encode("utf-8")
    if len(pwd_bytes) > BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError(f"Password cannot exceed {BCRYPT_MAX_PASSWORD_BYTES} bytes")
    return bcrypt.hashpw(pwd_bytes, bcrypt.gensalt(rounds=12)).decode("utf-8")

def verify_password(password: str, password_hash: str) -> bool:
    if not isinstance(password, str) or not isinstance(password_hash, str):
        return False
    pwd_bytes = password.encode("utf-8")
    if len(pwd_bytes) > BCRYPT_MAX_PASSWORD_BYTES:
        return False
    try:
        return bcrypt.checkpw(pwd_bytes, password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False

def create_access_token(subject: str) -> str:
    expires = utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": subject, "exp": expires}, settings.secret_key, algorithm=ALGORITHM)

def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except (jwt.JWTError, TypeError, ValueError):
        return None

def decode_jwt_subject(token: str) -> str | None:
    payload = decode_access_token(token)
    if payload is None:
        return None
    sub = payload.get("sub")
    return str(sub) if sub is not None else None

def extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    raw = authorization.split(" ", 1)[1].strip()
    return raw if raw else None

def generate_api_key() -> tuple[str, str, str]:
    raw = "afaq_" + secrets.token_urlsafe(32)
    return raw, raw[:14], hashlib.sha256(raw.encode()).hexdigest()

def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()

def _fernet() -> Fernet:
    key = settings.credentials_key.encode()
    key = hashlib.sha256(key).digest()
    import base64
    return Fernet(base64.urlsafe_b64encode(key))

def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()

def decrypt_secret(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()
