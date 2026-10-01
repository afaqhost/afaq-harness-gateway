"""Data access for usage records."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import UsageRecord


async def list_usage(
    db: AsyncSession,
    user_id: int,
    limit: int = 20,
    offset: int = 0,
    harness: str | None = None,
    model: str | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> tuple[list[UsageRecord], int]:
    # base filter by user
    base = select(UsageRecord).where(UsageRecord.user_id == user_id)
    if harness:
        base = base.where(UsageRecord.harness == harness)
    if model:
        base = base.where(UsageRecord.model == model)
    if from_dt:
        base = base.where(UsageRecord.created_at >= from_dt)
    if to_dt:
        base = base.where(UsageRecord.created_at <= to_dt)

    # total count with same filters
    count_stmt = select(func.count()).select_from(base.subquery())
    total = await db.scalar(count_stmt) or 0

    # paginated items
    stmt = base.order_by(desc(UsageRecord.created_at)).limit(limit).offset(offset)
    result = await db.execute(stmt)
    items = list(result.scalars().all())
    return items, int(total)


async def count_usage_for_user(db: AsyncSession, user_id: int) -> int:
    stmt = select(func.count()).select_from(UsageRecord).where(UsageRecord.user_id == user_id)
    return int(await db.scalar(stmt) or 0)


async def record_usage(
    db: AsyncSession,
    *,
    user_id: int,
    api_key_id: int | None = None,
    harness: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int | None = None,
    latency_ms: int = 0,
    cached_tokens: int = 0,
    status: str = "success",
    cost: float = 0.0,
    auto_commit: bool = True,
) -> UsageRecord:
    """Create and optionally commit a new UsageRecord."""
    tot = total_tokens if total_tokens is not None else (prompt_tokens + completion_tokens)
    rec = UsageRecord(
        user_id=user_id,
        api_key_id=api_key_id,
        harness=harness,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        total_tokens=tot,
        latency_ms=latency_ms,
        status=status,
        cost=cost,
    )
    db.add(rec)
    if auto_commit:
        await db.commit()
    return rec
