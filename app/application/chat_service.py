from app.domain.harness import ChatInput, ChatOutput, HarnessPort

class UnknownHarnessError(Exception):
    pass

class ChatService:
    def __init__(self, registry: dict[str, HarnessPort]):
        self.registry = registry

    @staticmethod
    def parse_model(model: str) -> tuple[str, str]:
        parts = model.split("/", 2)
        if len(parts) == 3: return parts[0], parts[2]
        if len(parts) == 2: return parts[0], parts[1]
        return parts[0], "default"

    def resolve(self, model: str) -> tuple[HarnessPort, str]:
        harness, model_name = self.parse_model(model)
        adapter = self.registry.get(harness)
        if not adapter: raise UnknownHarnessError(harness)
        return adapter, model_name

    async def execute(self, request: ChatInput) -> ChatOutput:
        adapter, model = self.resolve(request.model)
        request = ChatInput(model=model, messages=request.messages, session_id=request.session_id)
        return await adapter.execute(request)
