from dataclasses import dataclass
from typing import AsyncIterator, Protocol

from app.models.harness import HarnessModel, HarnessResult

# Backwards-compatible alias — older code imported ModelInfo from domain.
ModelInfo = HarnessModel

@dataclass(frozen=True)
class ChatInput:
    model: str
    messages: list[dict]
    session_id: str | None = None

@dataclass(frozen=True)
class ChatOutput:
    text: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0

class HarnessPort(Protocol):
    name: str
    def is_installed(self) -> bool: ...
    async def list_models(self) -> list[ModelInfo]: ...
    async def execute(self, request: ChatInput) -> ChatOutput: ...
    async def stream(self, request: ChatInput) -> AsyncIterator[tuple[str, dict]]: ...
