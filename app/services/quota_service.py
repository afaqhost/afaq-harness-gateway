"""Quota enforcement — atomic database-backed daily/monthly reservations per APIKey.

Production design for SQLite + aiosqlite in WAL mode:
1. Always isolated quota transactions from request sessions using a dedicated session
   from the configured application session factory (dynamically resolved from database.SessionLocal
   or via an injectable seam).
2. Atomic reservation via dedicated `QuotaReservation` rows using `BEGIN IMMEDIATE`
   transactions in SQLite to prevent race conditions across concurrent processes/sessions.
3. Counting logic counts completed `UsageRecord` rows + active `QuotaReservation` rows
   (where `expires_at > utcnow()`) within the current UTC daily and monthly windows.
4. Expired reservations (`expires_at <= utcnow()`) do not count towards limits and are
   cleaned up best-effort. Expiry is set beyond the maximum harness duration.
5. On success, `finalize_reservation` deletes the reservation and inserts the `UsageRecord`
   in the exact same transaction, preventing double-counting or quota gaps. Fails closed
   if the token is absent or already finalized.
6. On failure, cancellation, client disconnect, or generator cleanup before success,
   `release_reservation` deletes the reservation in a dedicated transaction.
7. SQLite busy/locked errors never fail open; they raise a bounded 503 service error.
"""

from __future__ import annotations

import logging
import secrets
import sqlite3
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.db import database
from app.db.database import APIKey, QuotaReservation, UsageRecord
from app.repositories.usage_repository import record_usage
from app.shared.time import utcnow

logger = logging.getLogger("afaq")

_custom_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the configured session factory.

    Resolves dynamically from app.db.database.SessionLocal unless explicitly overridden,
    ensuring unittest patches on `app.db.database.SessionLocal` or via `set_session_factory`
    are always honored.
    """
    if _custom_session_factory is not None:
        return _custom_session_factory
    return database.SessionLocal


def set_session_factory(factory: async_sessionmaker[AsyncSession] | None) -> None:
    """Narrow seam to inject a test session factory."""
    global _custom_session_factory
    _custom_session_factory = factory


def daily_monthly_bounds(now: datetime) -> tuple[datetime, datetime]:
    """Return UTC start of day and start of month for the given naive UTC timestamp."""
    return datetime(now.year, now.month, now.day), datetime(now.year, now.month, 1)


async def _count_since(db: AsyncSession, api_key_id: int, since: datetime, now: datetime) -> int:
    """Count completed usage records plus active reservations since `since`."""
    usage_stmt = select(func.count()).select_from(UsageRecord).where(
        UsageRecord.api_key_id == api_key_id,
        UsageRecord.created_at >= since,
    )
    usage_count = (await db.scalar(usage_stmt)) or 0

    res_stmt = select(func.count()).select_from(QuotaReservation).where(
        QuotaReservation.api_key_id == api_key_id,
        QuotaReservation.created_at >= since,
        QuotaReservation.expires_at > now,
    )
    res_count = (await db.scalar(res_stmt)) or 0
    return int(usage_count + res_count)


async def is_quota_exceeded(
    db: AsyncSession | APIKey,
    api_key: APIKey | None = None,
    now: datetime | None = None,
) -> tuple[bool, str]:
    """Return (True, 'daily'|'monthly') if quota is exceeded.

    Counts completed usage records + active reservations for that API key
    inside UTC daily/monthly windows. Expired reservations do not count.
    Supports is_quota_exceeded(db, api_key) and is_quota_exceeded(api_key).
    """
    key_obj: APIKey
    if isinstance(db, APIKey) and api_key is None:
        key_obj = db
    elif api_key is not None:
        key_obj = api_key
    else:
        raise ValueError("APIKey is required to check quota.")

    if getattr(key_obj, "id", None) is None:
        raise ValueError("Valid APIKey with an integer id is required to check quota.")

    api_key_id = int(key_obj.id)
    daily_limit = key_obj.daily_limit
    monthly_limit = key_obj.monthly_limit

    if daily_limit is None and monthly_limit is None:
        return False, ""

    now = now or utcnow()
    today_start, month_start = daily_monthly_bounds(now)

    factory = get_session_factory()
    async with factory() as session:
        if daily_limit is not None:
            count = await _count_since(session, api_key_id, today_start, now)
            if count >= daily_limit:
                return True, "daily"
        if monthly_limit is not None:
            count = await _count_since(session, api_key_id, month_start, now)
            if count >= monthly_limit:
                return True, "monthly"
        return False, ""


async def enforce_quota(
    db: AsyncSession | APIKey,
    api_key: APIKey | None = None,
    now: datetime | None = None,
) -> None:
    """Raise 429 if quota exceeded (backward-compatible check)."""
    key_obj: APIKey
    if isinstance(db, APIKey) and api_key is None:
        key_obj = db
    elif api_key is not None:
        key_obj = api_key
    else:
        raise ValueError("APIKey is required to enforce quota.")

    exceeded, kind = await is_quota_exceeded(key_obj, now=now)
    if exceeded:
        limit = key_obj.daily_limit if kind == "daily" else key_obj.monthly_limit
        detail = {
            "error": {
                "code": "quota_exceeded",
                "message": f"{kind.capitalize()} quota exceeded ({limit} requests).",
                "kind": kind,
                "limit": limit,
            }
        }
        raise HTTPException(
            status_code=429,
            detail=detail,
            headers={"Retry-After": "86400" if kind == "daily" else "2592000"},
        )


async def reserve_quota(
    api_key: APIKey,
    db: AsyncSession | None = None,
    *,
    now: datetime | None = None,
    ttl_seconds: int | None = None,
) -> QuotaReservation:
    """Atomically reserve quota for `api_key` before subprocess dispatch.

    - Validates api_key identity and limits upfront without session operations.
    - Always uses a dedicated session from the configured session factory to isolate
      quota transactions and maintain SQLite BEGIN IMMEDIATE integrity.
    - If caller passes `db`, it is never committed or rolled back.
    - Atomically counts completed UsageRecord rows + active QuotaReservation rows in current UTC windows.
    - Expired reservations do not count and are cleaned up best-effort.
    - Returns the created `QuotaReservation` on success.
    - Raises 429 if limit reached; raises 503 if database is locked/busy (never fails open).
    """
    if api_key is None or getattr(api_key, "id", None) is None:
        raise ValueError("Valid APIKey with an integer id is required for quota reservation.")

    api_key_id = int(api_key.id)
    daily_limit = api_key.daily_limit
    monthly_limit = api_key.monthly_limit

    now = now or utcnow()
    if ttl_seconds is None:
        ttl_seconds = max(settings.harness_timeout_seconds + 60, 900)

    factory = get_session_factory()
    async with factory() as session:
        try:
            bind = session.get_bind()
            dialect_name = getattr(getattr(bind, "dialect", None), "name", "")
            is_sqlite = dialect_name == "sqlite" or "sqlite" in settings.database_url
            if is_sqlite:
                await session.execute(text("BEGIN IMMEDIATE"))

            # Best-effort prune of expired reservations
            await session.execute(delete(QuotaReservation).where(QuotaReservation.expires_at <= now))

            today_start, month_start = daily_monthly_bounds(now)

            # Atomic count of usage + active reservations
            if daily_limit is not None:
                count = await _count_since(session, api_key_id, today_start, now)
                if count >= daily_limit:
                    await session.rollback()
                    detail = {
                        "error": {
                            "code": "quota_exceeded",
                            "message": f"Daily quota exceeded ({daily_limit} requests).",
                            "kind": "daily",
                            "limit": daily_limit,
                        }
                    }
                    raise HTTPException(status_code=429, detail=detail, headers={"Retry-After": "86400"})

            if monthly_limit is not None:
                count = await _count_since(session, api_key_id, month_start, now)
                if count >= monthly_limit:
                    await session.rollback()
                    detail = {
                        "error": {
                            "code": "quota_exceeded",
                            "message": f"Monthly quota exceeded ({monthly_limit} requests).",
                            "kind": "monthly",
                            "limit": monthly_limit,
                        }
                    }
                    raise HTTPException(status_code=429, detail=detail, headers={"Retry-After": "2592000"})

            # Admission granted: create opaque reservation
            token = secrets.token_hex(24)
            expires_at = now + timedelta(seconds=ttl_seconds)
            reservation = QuotaReservation(
                token=token,
                api_key_id=api_key_id,
                created_at=now,
                expires_at=expires_at,
            )

            session.add(reservation)
            await session.commit()
            return reservation

        except (OperationalError, sqlite3.OperationalError) as exc:
            logger.error("reserve_quota_lock_busy error=%s", exc)
            await session.rollback()
            raise HTTPException(
                status_code=503,
                detail={
                    "error": {
                        "code": "service_unavailable",
                        "message": "Database is temporarily busy. Please retry shortly.",
                        "retryable": True,
                    }
                },
                headers={"Retry-After": "1"},
            )
        except HTTPException:
            raise
        except Exception as exc:
            await session.rollback()
            logger.error("reserve_quota_unexpected error=%s", exc)
            raise


async def finalize_reservation(
    token: str | None = None,
    *,
    user_id: int,
    api_key_id: int | None = None,
    harness: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    cached_tokens: int = 0,
    total_tokens: int | None = None,
    latency_ms: int = 0,
    status: str = "success",
    cost: float = 0.0,
    db: AsyncSession | None = None,
) -> UsageRecord | None:
    """Finalize a quota reservation into a completed UsageRecord on success.

    In one dedicated transaction:
    - If a non-null token is provided, deletes the reservation by token.
      If token is absent/already finalized, rolls back and returns None (fail closed).
      Never inserts a usage record if token is not found.
    - Inserts exactly one UsageRecord row.
    - Requires a valid integer user_id.
    - Never uses caller session or falls back to a second session.
    """
    if user_id is None or not isinstance(user_id, int):
        raise ValueError("Valid integer user_id is required for usage finalization.")

    factory = get_session_factory()
    try:
        async with factory() as session:
            try:
                if token:
                    del_stmt = delete(QuotaReservation).where(QuotaReservation.token == token)
                    res = await session.execute(del_stmt)
                    if (res.rowcount or 0) == 0:
                        logger.warning("finalize_reservation: token %s not found or already finalized", token)
                        await session.rollback()
                        return None

                rec = await record_usage(
                    session,
                    user_id=user_id,
                    api_key_id=api_key_id,
                    harness=harness,
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cached_tokens=cached_tokens,
                    total_tokens=total_tokens,
                    latency_ms=latency_ms,
                    status=status,
                    cost=cost,
                    auto_commit=False,
                )
                await session.commit()
                return rec
            except Exception as exc:
                await session.rollback()
                logger.error("finalize_reservation_failed token=%s error=%s", token, exc)
                return None
    except Exception as exc:
        logger.error("finalize_reservation_session_error token=%s error=%s", token, exc)
        return None


async def release_reservation(
    token: str | None,
    db: AsyncSession | None = None,
) -> bool:
    """Release a reserved quota slot on failure, cancellation, or disconnect.

    Deletes the active QuotaReservation row by token, making the slot available again immediately.
    Uses one dedicated transaction.
    Preserves idempotent False for missing or empty tokens.
    """
    if not token:
        return False

    factory = get_session_factory()
    try:
        async with factory() as session:
            try:
                res = await session.execute(
                    delete(QuotaReservation).where(QuotaReservation.token == token)
                )
                await session.commit()
                return bool(res.rowcount and res.rowcount > 0)
            except Exception as exc:
                await session.rollback()
                logger.error("release_reservation_failed token=%s error=%s", token, exc)
                return False
    except Exception as exc:
        logger.error("release_reservation_session_error token=%s error=%s", token, exc)
        return False


async def cleanup_expired_reservations(db: AsyncSession | None = None, now: datetime | None = None) -> int:
    """Best-effort cleanup of expired reservation rows using a dedicated session."""
    now = now or utcnow()
    stmt = delete(QuotaReservation).where(QuotaReservation.expires_at <= now)
    factory = get_session_factory()
    async with factory() as session:
        try:
            res = await session.execute(stmt)
            await session.commit()
            return int(res.rowcount or 0)
        except Exception as exc:
            await session.rollback()
            logger.warning("cleanup_expired_reservations error=%s", exc)
            return 0
