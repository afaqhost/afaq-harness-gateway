from app.core.config import settings
from app.domain.harness import ChatInput, ChatOutput, HarnessPort
from app.shared.model_utils import parse_model_identifier
from app.shared.prompt_utils import build_harness_prompt, build_history_prompt


class UnknownHarnessError(Exception):
    pass


class ChatService:
    """Orchestrates harness execution — the business verb 'generate chat completion'.

    Thin over the HarnessPort abstraction; keeps controllers free of model
    parsing and prompt assembly.
    """

    def __init__(self, registry: dict[str, HarnessPort]):
        self.registry = registry

    @staticmethod
    def parse_model(model: str) -> tuple[str, str]:
        return parse_model_identifier(model)

    def resolve(self, model: str) -> tuple[HarnessPort, str]:
        harness, model_name = self.parse_model(model)
        adapter = self.registry.get(harness)
        if not adapter:
            raise UnknownHarnessError(harness)
        return adapter, model_name

    def _build_prompt(self, messages: list[dict]) -> str:
        system_parts = [m["content"] for m in messages if m.get("role") == "system"]
        system_prompt = "\n".join(system_parts) if system_parts else settings.default_system_prompt
        other = [(m["role"], m["content"]) for m in messages if m.get("role") != "system"]
        history = build_history_prompt(other)
        return build_harness_prompt(system_prompt, history)

    async def execute(self, request: ChatInput) -> ChatOutput:
        adapter, model = self.resolve(request.model)
        prompt = self._build_prompt(request.messages)
        result = await adapter.run(prompt, model, session_id=request.session_id)
        return ChatOutput(
            text=result.text,
            model=result.model,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            cached_tokens=result.cached_tokens,
        )

    async def stream(self, request: ChatInput):
        adapter, model = self.resolve(request.model)
        prompt = self._build_prompt(request.messages)
        async for chunk, metadata in adapter.stream(prompt, model, session_id=request.session_id):
            yield chunk, metadata
