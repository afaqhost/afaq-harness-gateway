"""Data access — the only place that knows the DB/SQL for conversations.

Controllers and services depend on these helpers instead of inline
SQLAlchemy queries (dependency direction: controller -> service -> repository).
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import Conversation, Message, User
from app.shared.model_utils import preview_text


async def get_conversation_or_404(conv_id: int, user: User, db: AsyncSession) -> Conversation:
    conv = await db.get(Conversation, conv_id)
    if not conv or conv.user_id != user.id:
        raise HTTPException(404, "Conversation not found")
    return conv


async def fetch_conversation_summary(conv: Conversation, db: AsyncSession) -> tuple[int, str | None]:
    from sqlalchemy import func

    count = await db.scalar(select(func.count()).select_from(Message).where(Message.conversation_id == conv.id)) or 0
    msgs = await db.execute(
        select(Message).where(Message.conversation_id == conv.id).order_by(desc(Message.created_at)).limit(1)
    )
    last = msgs.scalar_one_or_none()
    preview = preview_text(last.content) if last else None
    return count, preview


async def list_conversations_for_user(user: User, db: AsyncSession) -> list[Conversation]:
    result = await db.execute(
        select(Conversation).where(Conversation.user_id == user.id).order_by(desc(Conversation.updated_at))
    )
    return list(result.scalars().all())
