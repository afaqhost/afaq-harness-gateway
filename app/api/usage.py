from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import current_user
from app.db.database import UsageRecord, User, get_db
from app.repositories import usage_repository

router = APIRouter()


def _record_to_dict(r: UsageRecord) -> dict:
    return {
        "id": r.id,
        "user_id": r.user_id,
        "api_key_id": r.api_key_id,
        "harness": r.harness,
        "model": r.model,
        "prompt_tokens": r.prompt_tokens,
        "completion_tokens": r.completion_tokens,
        "cached_tokens": r.cached_tokens,
        "total_tokens": r.total_tokens,
        "cost": r.cost,
        "latency_ms": r.latency_ms,
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("/usage")
async def list_usage(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    harness: str | None = None,
    model: str | None = None,
    from_dt: datetime | None = Query(default=None, alias="from"),
    to_dt: datetime | None = Query(default=None, alias="to"),
):
    # additional validation for from/to
    if from_dt and to_dt and from_dt > to_dt:
        raise HTTPException(status_code=400, detail={"error": {"code": "validation_error", "message": "'from' must be before 'to'"}})

    items, total = await usage_repository.list_usage(
        db, user.id, limit=limit, offset=offset, harness=harness, model=model, from_dt=from_dt, to_dt=to_dt
    )
    return {
        "items": [_record_to_dict(i) for i in items],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
