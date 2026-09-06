import hashlib
import secrets
from datetime import timedelta

from cryptography.fernet import Fernet
from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.shared.time import utcnow

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ALGORITHM = "HS256"

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)

def create_access_token(subject: str) -> str:
    expires = utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": subject, "exp": expires}, settings.secret_key, algorithm=ALGORITHM)

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
