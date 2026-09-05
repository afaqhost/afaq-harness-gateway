import asyncio
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.auth import admin_user, current_user
from app.core.security import generate_api_key, hash_password
from app.db.database import APIKey, Harness, User, get_db
from app.harnesses.registry import all_adapters, cached_models, get_adapter, refresh_models
from app.services.harness_job_service import harness_job_service
from app.shared.sse import sse_event

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
async def harnesses(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = {h.name: h for h in (await db.execute(select(Harness))).scalars().all()}
    # also fetch credential profiles for this user to determine authenticated per harness
    from app.db.database import CredentialProfile

    cred_rows = (await db.execute(select(CredentialProfile).where(CredentialProfile.user_id == user.id, CredentialProfile.status == "authenticated"))).scalars().all()
    authenticated_harnesses = {c.harness for c in cred_rows}
    result = []
    for adapter in all_adapters():
        installed = adapter.is_installed()
        row = rows.get(adapter.name)
        models = cached_models(adapter.name)
        # authenticated is true if either Harness table says so or credential profile is authenticated
        is_auth = bool(row.authenticated) if row and row.authenticated else (adapter.name in authenticated_harnesses)
        result.append({"name": adapter.name, "display_name": adapter.display_name, "provider": adapter.provider or None, "installed": installed, "authenticated": is_auth, "models": [m.__dict__ for m in models], "last_checked_at": row.last_checked_at.isoformat() if row and row.last_checked_at else None})
    return result


@router.get("/harnesses/{name}/health")
async def harness_health(name: str, _: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    try:
        adapter = get_adapter(name)
    except KeyError:
        raise HTTPException(404, "Harness not found")
    start = time.monotonic()
    installed = adapter.is_installed()
    models = []
    latency_ms = int((time.monotonic() - start) * 1000)
    if installed:
        try:
            models = await asyncio.wait_for(adapter.list_models(), timeout=5)
            latency_ms = int((time.monotonic() - start) * 1000)
        except asyncio.TimeoutError:
            latency_ms = int((time.monotonic() - start) * 1000)
            models = []
        except Exception:
            latency_ms = int((time.monotonic() - start) * 1000)
            models = []
    # update Harness.last_checked_at in DB
    try:
        row = (await db.execute(select(Harness).where(Harness.name == name))).scalar_one_or_none()
        if not row:
            row = Harness(name=name, display_name=adapter.display_name, executable=adapter.executable, provider=adapter.provider or "", installed=installed, last_checked_at=datetime.utcnow())
            db.add(row)
        else:
            row.installed = installed
            row.last_checked_at = datetime.utcnow()
            row.display_name = adapter.display_name
        await db.commit()
    except Exception:
        await db.rollback()
    return {"name": name, "installed": installed, "models": len(models), "latency_ms": latency_ms, "authenticated": False}

@router.post("/harnesses/refresh")
async def refresh_harness_models(_: User = Depends(current_user)):
    await refresh_models()
    return {"status": "refreshed"}

@router.post("/harnesses/{name}/install")
async def install_harness(name: str, _: User = Depends(admin_user)):
    try:
        adapter = get_adapter(name)
    except KeyError:
        raise HTTPException(404, "Harness not found")
    # allow-list: only npm install -g
    cmd = getattr(adapter, "install_command", None)
    if not cmd or len(cmd) < 3 or cmd[0] != "npm" or cmd[1] != "install" or "-g" not in cmd:
        raise HTTPException(400, detail={"error": {"code": "no_recipe", "message": "No install recipe for harness"}})
    job = await harness_job_service.start_install(adapter)
    return {"job_id": job.id, "status": job.stage, "harness": name}


@router.get("/harnesses/{name}/jobs/{job_id}")
async def get_harness_job(name: str, job_id: str, _: User = Depends(current_user)):
    # verify harness exists
    try:
        get_adapter(name)
    except KeyError:
        raise HTTPException(404, "Harness not found")
    job = await harness_job_service.get(job_id)
    if not job or job.harness != name:
        raise HTTPException(404, detail={"error": {"code": "not_found", "message": "Job not found"}})
    return job.to_dict()


@router.get("/harnesses/{name}/jobs/{job_id}/stream")
async def stream_harness_job(name: str, job_id: str, _: User = Depends(current_user)):
    try:
        get_adapter(name)
    except KeyError:
        raise HTTPException(404, "Harness not found")
    job = await harness_job_service.get(job_id)
    if not job or job.harness != name:
        raise HTTPException(404, detail={"error": {"code": "not_found", "message": "Job not found"}})

    async def event_stream():
        # stream existing logs then poll for updates
        last_idx = 0
        seq = 1
        while True:
            # yield new logs
            current_logs = job.logs[last_idx:]
            for msg in current_logs:
                # event: log per line
                yield sse_event("log", {"message": msg, "stage": job.stage}, id=seq)
                seq += 1
            last_idx = len(job.logs)
            if job.stage in ("completed", "failed"):
                yield sse_event("done", {"stage": job.stage, "exit_code": job.exit_code}, id=seq)
                break
            await asyncio.sleep(0.2)

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@router.post("/harnesses/{name}/update")
async def update_harness(name: str, _: User = Depends(admin_user)):
    try:
        adapter = get_adapter(name)
    except KeyError:
        raise HTTPException(404, "Harness not found")
    cmd = getattr(adapter, "update_command", None)
    if not cmd or len(cmd) < 1:
        raise HTTPException(400, detail={"error": {"code": "no_recipe", "message": "No update recipe"}})
    job = await harness_job_service.start_update(adapter)
    return {"job_id": job.id, "status": job.stage, "harness": name}

@router.post("/users", response_model=dict)
async def create_user(user_payload: UserCreate, _: User = Depends(admin_user), db: AsyncSession = Depends(get_db)):
    if (await db.execute(select(User).where(User.email == user_payload.email))).scalar_one_or_none():
        raise HTTPException(409, "Email already exists")
    user = User(
        email=user_payload.email,
        password_hash=hash_password(user_payload.password),
        display_name=user_payload.display_name,
        role=user_payload.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"id": user.id, "email": user.email, "role": user.role}

@router.get("/users")
async def list_users(_: User = Depends(admin_user), db: AsyncSession = Depends(get_db)):
    return [{"id": u.id, "email": u.email, "display_name": u.display_name, "role": u.role, "is_active": u.is_active} for u in (await db.execute(select(User).order_by(User.id))).scalars().all()]

@router.post("/keys")
async def create_key(key_payload: KeyCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    raw, prefix, digest = generate_api_key()
    key = APIKey(
        user_id=user.id,
        name=key_payload.name,
        key_prefix=prefix,
        key_hash=digest,
        daily_limit=key_payload.daily_limit,
        monthly_limit=key_payload.monthly_limit,
        allowed_models=key_payload.allowed_models,
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
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
