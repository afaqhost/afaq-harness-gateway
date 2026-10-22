"""Business logic — chat generation orchestration.

Controllers should delegate here instead of building prompts or
choosing harnesses themselves (thin controllers, rich services).
"""

from __future__ import annotations

from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.application.chat_service import ChatService, UnknownHarnessError
from app.clients.registry import ADAPTERS
from app.core.config import settings
from app.db.database import Conversation, Message
from app.domain.harness import ChatInput, ChatOutput
from app.repositories.conversation_repository import list_conversation_messages
from app.shared.model_utils import preview_text
from app.shared.prompt_utils import build_harness_prompt, build_history_prompt
from app.shared.time import utcnow

# Default wiring for callers that don't inject a registry.
default_chat_service = ChatService(registry=ADAPTERS)

__all__ = ["ChatService", "UnknownHarnessError", "ChatInput", "ChatOutput", "default_chat_service"]


async def generate_chat_completion(request: ChatInput) -> ChatOutput:
    return await default_chat_service.execute(request)


async def stream_chat_completion(request: ChatInput) -> AsyncIterator[tuple[str, dict]]:
    async for chunk, meta in default_chat_service.stream(request):
        yield chunk, meta


async def save_user_message_and_build_prompt(db: AsyncSession, conversation: Conversation, content: str) -> str:
    """Use one history snapshot per send and commit its user message before dispatch."""
    history = await list_conversation_messages(db, conversation.id)
    if not history or conversation.title in ("New chat", "محادثة جديدة", ""):
        conversation.title = preview_text(content, 50)
    conversation.updated_at = utcnow()
    user_message = Message(conversation_id=conversation.id, role="user", content=content)
    db.add(user_message)
    await db.commit()
    history.append(user_message)
    history.sort(key=lambda message: (message.created_at, message.id))
    history_prompt = build_history_prompt([(message.role, message.content) for message in history])
    return build_harness_prompt(settings.default_system_prompt, history_prompt)
