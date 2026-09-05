import pytest

from app.application.chat_service import ChatService, UnknownHarnessError
from app.domain.harness import ChatInput
pytestmark = pytest.mark.unit


class StubAdapter:
    name = "stub"

    def __init__(self, text="stub answer"):
        self._text = text
        self.last_prompt = None
        self.last_model = None

    def is_installed(self):
        return True

    async def list_models(self):
        return []

    def build_command(self, prompt, model=None, session_id=None):
        return ["echo", prompt]

    def parse_line(self, line, model):
        return line, {}

    def parse_output(self, output, model):
        return output.decode()

    async def run(self, prompt, model=None, session_id=None, env=None):
        self.last_prompt = prompt
        self.last_model = model
        from app.models.harness import HarnessResult

        return HarnessResult(text=self._text, model=model or "default")

    async def stream(self, prompt, model=None, session_id=None, env=None):
        yield self._text, {}


def test_chat_service_parse_model_delegates_to_shared_util():
    assert ChatService.parse_model("opencode//opencode/big-pickle") == ("opencode", "opencode/big-pickle")


def test_chat_service_resolve_unknown_harness_raises():
    svc = ChatService(registry={})
    with pytest.raises(UnknownHarnessError):
        svc.resolve("missing//model")


def test_chat_service_resolve_returns_adapter_and_model_name():
    stub = StubAdapter()
    svc = ChatService(registry={"stub": stub})
    adapter, model = svc.resolve("stub//my-model")
    assert adapter is stub
    assert model == "my-model"


@pytest.mark.asyncio
async def test_chat_service_execute_builds_prompt_and_calls_adapter():
    stub = StubAdapter(text="hello world")
    svc = ChatService(registry={"stub": stub})
    req = ChatInput(model="stub//my-model", messages=[{"role": "user", "content": "hi"}])
    out = await svc.execute(req)
    assert out.text == "hello world"
    assert out.model == "my-model"
    assert stub.last_prompt is not None
    assert "SYSTEM:" in stub.last_prompt
    assert "user: hi" in stub.last_prompt


@pytest.mark.asyncio
async def test_chat_service_execute_includes_system_messages():
    stub = StubAdapter(text="ok")
    svc = ChatService(registry={"stub": stub})
    req = ChatInput(model="stub//m", messages=[{"role": "system", "content": "be brief"}, {"role": "user", "content": "hello"}])
    await svc.execute(req)
    assert "be brief" in stub.last_prompt
    assert "user: hello" in stub.last_prompt


@pytest.mark.asyncio
async def test_chat_service_stream_yields_adapter_chunks():
    stub = StubAdapter(text="chunked")
    svc = ChatService(registry={"stub": stub})
    req = ChatInput(model="stub//m", messages=[{"role": "user", "content": "hi"}])
    chunks = []
    async for c, meta in svc.stream(req):
        chunks.append(c)
    assert "".join(chunks) == "chunked"