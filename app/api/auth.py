from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel, ConfigDict, EmailStr, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.security import (
    create_access_token,
    decode_jwt_subject,
    extract_bearer_token,
    hash_password,
    verify_password,
)
from app.db.database import User, get_db
from app.repositories.auth_repository import (
    get_user_by_id,
)

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str = ""

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password cannot exceed 72 bytes")
        return v


class SetupStatusOut(BaseModel):
    needs_setup: bool
    has_users: bool

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str
    role: str
    is_active: bool

async def current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    raw_token = token
    if not raw_token and request.method == "GET" and request.url.path.endswith("/stream"):
        raw_token = request.query_params.get("token") or request.query_params.get("access_token")
    if not raw_token:
        auth = request.headers.get("authorization") or request.headers.get("Authorization")
        raw_token = extract_bearer_token(auth)
    if not raw_token:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    sub = decode_jwt_subject(raw_token)
    if sub:
        try:
            user_id = int(sub)
            user = await get_user_by_id(db, user_id)
            if user and user.is_active:
                return user
            raise HTTPException(status_code=401, detail="Inactive or missing user")
        except ValueError:
            pass
    raise HTTPException(status_code=401, detail="Invalid authentication credentials")

async def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin": raise HTTPException(status_code=403, detail="Administrator permission required")
    return user

@router.get("/setup-status", response_model=SetupStatusOut)
async def setup_status(db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(User).limit(1))).scalar_one_or_none()
    has_users = existing is not None
    return SetupStatusOut(needs_setup=not has_users, has_users=has_users)


@router.get("/bootstrap/status", response_model=SetupStatusOut)
async def bootstrap_status(db: AsyncSession = Depends(get_db)):
    # alias for setup-status for backward compat / docs
    existing = (await db.execute(select(User).limit(1))).scalar_one_or_none()
    has_users = existing is not None
    return SetupStatusOut(needs_setup=not has_users, has_users=has_users)


@router.post("/bootstrap")
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
    # Return user fields + access_token for auto-login (wizard flow)
    # Keep backward compat: top-level user fields + token
    token = create_access_token(str(user.id))
    user_data = UserOut.model_validate(user).model_dump()
    return {**user_data, "access_token": token, "token_type": "bearer", "user": user_data}

@router.post("/login")
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    if len(form.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=422, detail="Password cannot exceed 72 bytes")
    email = form.username.strip().lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    # fallback case-sensitive for legacy data
    if not user:
        user = (await db.execute(select(User).where(User.email == form.username.strip()))).scalar_one_or_none()
    if not user or not verify_password(form.password, user.password_hash) or not user.is_active:
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {"access_token": create_access_token(str(user.id)), "token_type": "bearer", "user": UserOut.model_validate(user).model_dump()}

@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)): return user