"""Quota enforcement — daily/monthly limits per APIKey."""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import APIKey, UsageRecord


async def _count_since(db: AsyncSession, api_key_id: int, since: datetime) -> int:
    stmt = select(func.count()).select_from(UsageRecord).where(
        UsageRecord.api_key_id == api_key_id,
        UsageRecord.created_at >= since,
    )
    result = await db.scalar(stmt)
    return int(result or 0)


async def is_quota_exceeded(db: AsyncSession, api_key: APIKey, now: datetime | None = None) -> tuple[bool, str]:
    """Return (True, 'daily'|'monthly') if quota is exceeded."""
    now = now or datetime.utcnow()
    # daily
    if api_key.daily_limit is not None:
        today_start = datetime(now.year, now.month, now.day)
        count = await _count_since(db, api_key.id, today_start)
        if count >= api_key.daily_limit:
            return True, "daily"
    # monthly
    if api_key.monthly_limit is not None:
        month_start = datetime(now.year, now.month, 1)
        count = await _count_since(db, api_key.id, month_start)
        if count >= api_key.monthly_limit:
            return True, "monthly"
    return False, ""


async def enforce_quota(db: AsyncSession, api_key: APIKey) -> None:
    """Raise 429 if quota exceeded."""
    exceeded, kind = await is_quota_exceeded(db, api_key)
    if exceeded:
        limit = api_key.daily_limit if kind == "daily" else api_key.monthly_limit
        detail = {
            "error": {
                "code": "quota_exceeded",
                "message": f"{kind.capitalize()} quota exceeded ({limit} requests).",
                "kind": kind,
                "limit": limit,
            }
        }
        raise HTTPException(status_code=429, detail=detail, headers={"Retry-After": "86400" if kind == "daily" else "2592000"})


def daily_monthly_bounds(now: datetime) -> tuple[datetime, datetime]:
    return datetime(now.year, now.month, now.day), datetime(now.year, now.month, 1)
