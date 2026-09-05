from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import current_user
from app.db.database import CredentialProfile, User, get_db
from app.harnesses.registry import get_adapter
from app.services import credential_service

router = APIRouter()


class CredentialCreate(BaseModel):
    profile_name: str = Field(default="default", max_length=80)
    auth_type: str = Field(default="token", max_length=20)  # environment|cli|token
    token: str | None = None


class CredentialOut(BaseModel):
    id: int
    harness: str
    profile_name: str
    auth_type: str
    status: str
    last_checked_at: datetime | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True


def _to_out(p: CredentialProfile) -> dict:
    return {
        "id": p.id,
        "harness": p.harness,
        "profile_name": p.profile_name,
        "auth_type": p.auth_type,
        "status": p.status,
        "last_checked_at": p.last_checked_at,
        "created_at": p.created_at,
    }


@router.post("/harnesses/{harness}/credentials", response_model=CredentialOut)
async def create_credential(harness: str, payload: CredentialCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    # validate harness exists
    try:
        get_adapter(harness)
    except KeyError:
        raise HTTPException(404, detail={"error": {"code": "not_found", "message": "Harness not found"}})
    # check existing? Unique constraint will handle, but we should give 409
    existing = (await db.execute(select(CredentialProfile).where(CredentialProfile.user_id == user.id, CredentialProfile.harness == harness, CredentialProfile.profile_name == payload.profile_name))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, detail={"error": {"code": "conflict", "message": "Profile already exists"}})
    # validate auth_type
    if payload.auth_type not in ("environment", "cli", "token"):
        raise HTTPException(400, detail={"error": {"code": "validation_error", "message": "auth_type must be environment|cli|token"}})
    if payload.auth_type == "token" and not payload.token:
        raise HTTPException(400, detail={"error": {"code": "validation_error", "message": "token required for auth_type=token"}})
    # for cli and environment, token may be None
    profile = await credential_service.create_profile(db, user.id, harness, payload.profile_name, payload.auth_type, payload.token)
    return _to_out(profile)


@router.get("/credentials", response_model=list[CredentialOut])
async def list_credentials(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    profiles = await credential_service.list_profiles(db, user.id)
    return [_to_out(p) for p in profiles]


@router.get("/harnesses/{harness}/credentials", response_model=list[CredentialOut])
async def list_harness_credentials(harness: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    try:
        get_adapter(harness)
    except KeyError:
        raise HTTPException(404, detail={"error": {"code": "not_found", "message": "Harness not found"}})
    result = await db.execute(select(CredentialProfile).where(CredentialProfile.user_id == user.id, CredentialProfile.harness == harness).order_by(CredentialProfile.profile_name))
    profiles = list(result.scalars().all())
    return [_to_out(p) for p in profiles]


@router.post("/credentials/{cred_id}/check", response_model=CredentialOut)
async def check_credential(cred_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    profile = await db.get(CredentialProfile, cred_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(404, detail={"error": {"code": "not_found", "message": "Credential not found"}})
    try:
        adapter = get_adapter(profile.harness)
    except KeyError:
        raise HTTPException(404, detail={"error": {"code": "not_found", "message": "Harness not found"}})
    try:
        result = await adapter.authenticate(mode=profile.auth_type)
        status = result.get("status", "unknown")
    except Exception:
        status = "failed"
    profile.status = status
    profile.last_checked_at = datetime.utcnow()
    await db.commit()
    await db.refresh(profile)
    # also update Harness.authenticated flag if status is authenticated
    try:
        from app.db.database import Harness

        row = (await db.execute(select(Harness).where(Harness.name == profile.harness))).scalar_one_or_none()
        if row:
            row.authenticated = status == "authenticated"
            await db.commit()
    except Exception:
        await db.rollback()
    return _to_out(profile)


@router.delete("/credentials/{cred_id}", status_code=204)
async def delete_credential(cred_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    profile = await db.get(CredentialProfile, cred_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(404, detail={"error": {"code": "not_found", "message": "Credential not found"}})
    await db.delete(profile)
    await db.commit()
    return None
