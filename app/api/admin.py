from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.auth import admin_user, current_user
from app.core.security import generate_api_key, hash_password
from app.db.database import APIKey, Harness, User, get_db
from app.harnesses.registry import all_adapters, cached_models, refresh_models

router = APIRouter()

class UserCreate(BaseModel):
    email: str
    password: str
    display_name: str = ""
    role: str = "user"

class KeyCreate(BaseModel):
    name: str
    daily_limit: int | None = None
    monthly_limit: int | None = None
    allowed_models: list[str] | None = None

@router.get("/harnesses")
async def harnesses(_: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = {h.name: h for h in (await db.execute(select(Harness))).scalars().all()}
    result = []
    for adapter in all_adapters():
        installed = adapter.is_installed()
        row = rows.get(adapter.name)
        models = cached_models(adapter.name)
        result.append({"name": adapter.name, "display_name": adapter.display_name, "provider": adapter.provider or None, "installed": installed, "authenticated": bool(row.authenticated) if row else False, "models": [m.__dict__ for m in models]})
    return result

@router.post("/harnesses/refresh")
async def refresh_harness_models(_: User = Depends(current_user)):
    await refresh_models()
    return {"status": "refreshed"}

@router.post("/harnesses/{name}/install")
async def install_harness(name: str, _: User = Depends(admin_user)):
    for adapter in all_adapters():
        if adapter.name == name: return {"status": "accepted", "message": "Use the installation stream endpoint in the next UI integration."}
    raise HTTPException(404, "Harness not found")

@router.post("/users", response_model=dict)
async def create_user(data: UserCreate, _: User = Depends(admin_user), db: AsyncSession = Depends(get_db)):
    if (await db.execute(select(User).where(User.email == data.email))).scalar_one_or_none(): raise HTTPException(409, "Email already exists")
    user = User(email=data.email, password_hash=hash_password(data.password), display_name=data.display_name, role=data.role)
    db.add(user); await db.commit(); await db.refresh(user); return {"id": user.id, "email": user.email, "role": user.role}

@router.get("/users")
async def list_users(_: User = Depends(admin_user), db: AsyncSession = Depends(get_db)):
    return [{"id": u.id, "email": u.email, "display_name": u.display_name, "role": u.role, "is_active": u.is_active} for u in (await db.execute(select(User).order_by(User.id))).scalars().all()]

@router.post("/keys")
async def create_key(data: KeyCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=user.id, name=data.name, key_prefix=prefix, key_hash=digest, daily_limit=data.daily_limit, monthly_limit=data.monthly_limit, allowed_models=data.allowed_models)
    db.add(key); await db.commit(); await db.refresh(key)
    return {"id": key.id, "name": key.name, "key": raw, "prefix": prefix, "warning": "This key is shown once. Store it securely."}

@router.get("/keys")
async def list_keys(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    keys = (await db.execute(select(APIKey).where(APIKey.user_id == user.id))).scalars().all()
    return [{"id": k.id, "name": k.name, "prefix": k.key_prefix, "is_active": k.is_active, "daily_limit": k.daily_limit, "monthly_limit": k.monthly_limit, "last_used_at": k.last_used_at} for k in keys]

@router.patch("/keys/{key_id}")
async def update_key(key_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    key = (await db.execute(select(APIKey).where(APIKey.id == key_id, APIKey.user_id == user.id))).scalar_one_or_none()
    if not key: raise HTTPException(404, "API key not found")
    key.is_active = not key.is_active
    await db.commit()
    return {"id": key.id, "is_active": key.is_active}

@router.delete("/keys/{key_id}", status_code=204)
async def delete_key(key_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    key = (await db.execute(select(APIKey).where(APIKey.id == key_id, APIKey.user_id == user.id))).scalar_one_or_none()
    if not key: raise HTTPException(404, "API key not found")
    await db.delete(key)
    await db.commit()
