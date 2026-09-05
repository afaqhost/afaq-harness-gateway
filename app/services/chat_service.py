"""Business logic — chat generation orchestration.

Controllers should delegate here instead of building prompts or
choosing harnesses themselves (thin controllers, rich services).
"""

from __future__ import annotations

from typing import AsyncIterator

from app.application.chat_service import ChatService, UnknownHarnessError
from app.clients.registry import ADAPTERS
from app.domain.harness import ChatInput, ChatOutput

# Default wiring for callers that don't inject a registry.
default_chat_service = ChatService(registry=ADAPTERS)

__all__ = ["ChatService", "UnknownHarnessError", "ChatInput", "ChatOutput", "default_chat_service"]


async def generate_chat_completion(request: ChatInput) -> ChatOutput:
    return await default_chat_service.execute(request)


async def stream_chat_completion(request: ChatInput) -> AsyncIterator[tuple[str, dict]]:
    async for chunk, meta in default_chat_service.stream(request):
        yield chunk, meta
