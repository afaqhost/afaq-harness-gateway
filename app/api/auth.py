from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.security import create_access_token, hash_api_key, hash_password, verify_password
from app.db.database import APIKey, User, get_db
from app.shared.time import utcnow

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str = ""

class UserOut(BaseModel):
    id: int
    email: str
    display_name: str
    role: str
    is_active: bool
    class Config: from_attributes = True

async def current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> User:
    # try JWT first
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id = int(payload.get("sub"))
        user = await db.get(User, user_id)
        if user and user.is_active:
            return user
        raise HTTPException(status_code=401, detail="Inactive or missing user")
    except (JWTError, TypeError, ValueError):
        pass
    # fallback: try API key (allows chat/OpenAI via API key)
    try:
        digest = hash_api_key(token)
        key = (await db.execute(select(APIKey).where(APIKey.key_hash == digest, APIKey.is_active == True))).scalar_one_or_none()
        if key:
            user = await db.get(User, key.user_id)
            if user and user.is_active:
                # update last_used_at best-effort
                try:
                    key.last_used_at = utcnow()
                    await db.commit()
                except (OSError, RuntimeError):
                    await db.rollback()
                return user
    except (OSError, RuntimeError) as exc:
        import logging; logging.getLogger("afaq").warning("api_key_lookup_failed error=%s", exc)
    raise HTTPException(status_code=401, detail="Invalid authentication credentials")

async def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin": raise HTTPException(status_code=403, detail="Administrator permission required")
    return user

@router.post("/bootstrap", response_model=UserOut)
async def bootstrap(registration: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(User).limit(1))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Bootstrap already completed")
    user = User(
        email=registration.email,
        password_hash=hash_password(registration.password),
        display_name=registration.display_name or registration.email.split("@")[0],
        role="admin",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

@router.post("/login")
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    email = form.username.strip().lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    # fallback case-sensitive for legacy data
    if not user:
        user = (await db.execute(select(User).where(User.email == form.username.strip()))).scalar_one_or_none()
    if not user or not verify_password(form.password, user.password_hash): raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {"access_token": create_access_token(str(user.id)), "token_type": "bearer", "user": UserOut.model_validate(user).model_dump()}

@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)): return user