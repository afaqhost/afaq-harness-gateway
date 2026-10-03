"""Repository for User and APIKey lookup operations."""

from __future__ import annotations

import logging

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_api_key
from app.db.database import (
    APIKey,
    Conversation,
    CredentialProfile,
    Message,
    QuotaReservation,
    UsageRecord,
    User,
)
from app.shared.time import utcnow

logger = logging.getLogger("afaq")


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    """Fetch user by primary key ID."""
    return await db.get(User, user_id)


async def get_active_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    """Fetch active user by primary key ID."""
    user = await db.get(User, user_id)
    return user if (user and user.is_active) else None


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    query = select(User).where(func.lower(User.email) == email.lower())
    return (await db.execute(query)).scalar_one_or_none()


async def list_users(db: AsyncSession) -> list[User]:
    return list((await db.execute(select(User).order_by(User.id))).scalars().all())


async def count_active_admins(db: AsyncSession) -> int:
    query = select(func.count(User.id)).where(User.role == "admin", User.is_active == True)
    return int((await db.execute(query)).scalar_one())


async def delete_user_and_owned_data(db: AsyncSession, user: User) -> None:
    key_ids = select(APIKey.id).where(APIKey.user_id == user.id)
    conversation_ids = select(Conversation.id).where(Conversation.user_id == user.id)
    await db.execute(delete(QuotaReservation).where(QuotaReservation.api_key_id.in_(key_ids)))
    await db.execute(
        delete(UsageRecord).where(
            or_(UsageRecord.user_id == user.id, UsageRecord.api_key_id.in_(key_ids))
        )
    )
    await db.execute(delete(APIKey).where(APIKey.user_id == user.id))
    await db.execute(delete(CredentialProfile).where(CredentialProfile.user_id == user.id))
    await db.execute(delete(Message).where(Message.conversation_id.in_(conversation_ids)))
    await db.execute(delete(Conversation).where(Conversation.user_id == user.id))
    await db.execute(delete(User).where(User.id == user.id))


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
