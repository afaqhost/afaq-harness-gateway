"""Repository for User and APIKey lookup operations."""

from __future__ import annotations

import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_api_key
from app.db.database import APIKey, User
from app.shared.time import utcnow

logger = logging.getLogger("afaq")


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    """Fetch user by primary key ID."""
    return await db.get(User, user_id)


async def get_active_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    """Fetch active user by primary key ID."""
    user = await db.get(User, user_id)
    return user if (user and user.is_active) else None


async def get_active_api_key_by_raw(db: AsyncSession, raw_key: str) -> APIKey | None:
    """Lookup active APIKey by raw unhashed key token."""
    digest = hash_api_key(raw_key)
    query = select(APIKey).where(APIKey.key_hash == digest, APIKey.is_active == True)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def touch_api_key_last_used(db: AsyncSession, key: APIKey) -> None:
    """Update last_used_at on APIKey best-effort."""
    try:
        key.last_used_at = utcnow()
        await db.commit()
    except (OSError, RuntimeError) as exc:
        logger.warning("api_key_touch_failed error=%s", exc)
        await db.rollback()
