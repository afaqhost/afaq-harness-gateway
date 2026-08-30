from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.database import User, get_db

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
    try: payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"]); user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError): raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    user = await db.get(User, user_id)
    if not user or not user.is_active: raise HTTPException(status_code=401, detail="Inactive or missing user")
    return user

async def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin": raise HTTPException(status_code=403, detail="Administrator permission required")
    return user

@router.post("/bootstrap", response_model=UserOut)
async def bootstrap(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    count = await db.scalar(select(User).count()) if False else None
    existing = (await db.execute(select(User).limit(1))).scalar_one_or_none()
    if existing: raise HTTPException(status_code=409, detail="Bootstrap already completed")
    user = User(email=data.email, password_hash=hash_password(data.password), display_name=data.display_name or data.email.split("@")[0], role="admin")
    db.add(user); await db.commit(); await db.refresh(user); return user

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
