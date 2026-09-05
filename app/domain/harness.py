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
    """Abstract client port — what services need from any harness.

    Mirrors ``app.clients.base.HarnessAdapter`` but as a Protocol so
    services depend on the abstraction (DIP), not the concrete.
    """

    name: str
    display_name: str
    executable: str
    provider: str

    def is_installed(self) -> bool: ...
    async def list_models(self) -> list[HarnessModel]: ...
    def build_command(self, prompt: str, model: str | None = None, session_id: str | None = None) -> list[str]: ...
    def parse_line(self, line: str, model: str) -> tuple[str, dict]: ...
    def parse_output(self, output: bytes, model: str) -> str: ...
    async def run(
        self, prompt: str, model: str | None = None, session_id: str | None = None, env: dict | None = None
    ) -> HarnessResult: ...
    async def stream(
        self, prompt: str, model: str | None = None, session_id: str | None = None, env: dict | None = None
    ) -> AsyncIterator[tuple[str, dict]]: ...
    async def install(self) -> AsyncIterator[dict]: ...
    async def update(self) -> AsyncIterator[dict]: ...
    async def authenticate(self, mode: str = "environment") -> dict: ...
