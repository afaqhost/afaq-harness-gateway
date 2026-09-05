import asyncio
import pytest
from unittest.mock import patch

from app.clients.base import HarnessAdapter
from app.clients.registry import MODEL_CACHE
from app.models.harness import HarnessModel
from app.services.process_registry import process_registry

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    yield
    MODEL_CACHE.clear()


@pytest.fixture(autouse=True)
def clear_registry():
    process_registry.clear()
    yield
    process_registry.clear()


class SlowAdapter(HarnessAdapter):
    name = "opencode"
    display_name = "OpenCode"
    executable = "sleep"

    def build_command(self, prompt, model=None, session_id=None):
        # Bash loop: echo chunk, sleep, echo chunk, sleep ... total ~6s
        return ["bash", "-c", "echo 'chunk1'; sleep 2; echo 'chunk2'; sleep 2; echo 'chunk3'; sleep 2"]

    def parse_line(self, line, model):
        # each line is a chunk
        return line.strip(), {}

    def parse_output(self, output, model):
        return output.decode(errors="replace").strip()


@pytest.mark.asyncio
async def test_chat_stream_cancel_kills_process(client, user_headers):
    # create conversation
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    assert resp.status_code == 200
    conv_id = resp.json()["id"]

    # patch get_adapter to return SlowAdapter for streaming
    with patch("app.api.chat.get_adapter", return_value=SlowAdapter()):
        # start stream in background task (httpx client post will block until stream completes)
        # we need to run the request concurrently and cancel mid-stream
        # Use asyncio.create_task to run the stream request
        async def start_stream():
            return await client.post(
                f"/api/chat/conversations/{conv_id}/messages/stream",
                headers=user_headers,
                json={"content": "hello", "model": "opencode//opencode/big-pickle"},
            )

        task = asyncio.create_task(start_stream())
        # give server time to start process and register
        await asyncio.sleep(0.5)
        # check registry has an entry for this conv
        assert process_registry.size() >= 1, "process should be registered"
        # find request_id for this conv
        keys = list(process_registry._map.keys())
        # should be chat:{conv_id}:...
        matching = [k for k in keys if k.startswith(f"chat:{conv_id}:")]
        assert len(matching) >= 1, f"expected chat prefix key, got {keys}"
        request_id = matching[0]
        # get handle to check pid
        handle = await process_registry.get(request_id)
        assert handle is not None
        pid = handle.pid
        assert pid != 0

        # call cancel endpoint (chat cancel by conv_id)
        cancel_resp = await client.post(f"/api/chat/conversations/{conv_id}/cancel", headers=user_headers)
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled"

        # registry should be empty now (cancel removed)
        await asyncio.sleep(0.3)
        assert process_registry.size() == 0

        # wait for stream task to complete (should return with cancel, not DONE)
        try:
            stream_resp = await asyncio.wait_for(task, timeout=5)
        except asyncio.TimeoutError:
            task.cancel()
            pytest.fail("stream task did not complete after cancel")

        # stream response should not contain [DONE], should contain cancelled
        text = stream_resp.text
        assert "cancelled" in text.lower(), f"expected cancelled in stream, got {text}"
        assert "[DONE]" not in text, "cancelled stream should not end with [DONE]"

        # second cancel should be 404
        cancel2 = await client.post(f"/api/chat/conversations/{conv_id}/cancel", headers=user_headers)
        assert cancel2.status_code == 404


@pytest.mark.asyncio
async def test_chat_cancel_unknown_returns_404(client, user_headers):
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]
    resp = await client.post(f"/api/chat/conversations/{conv_id}/cancel", headers=user_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_openai_stream_cancel_kills_process(client, db_session, regular_user):
    from app.core.security import generate_api_key
    from app.db.database import APIKey
    from app.models.harness import HarnessResult

    # create API key
    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=regular_user.id, name="cancel-key", key_prefix=prefix, key_hash=digest)
    db_session.add(key)
    await db_session.commit()
    headers = {"Authorization": f"Bearer {raw}"}

    # Slow adapter for openai
    class SlowOpenAdapter(HarnessAdapter):
        name = "opencode"
        display_name = "OpenCode"
        executable = "sleep"

        def build_command(self, prompt, model=None, session_id=None):
            return ["bash", "-c", "echo 'tok1'; sleep 2; echo 'tok2'; sleep 2"]

        def parse_line(self, line, model):
            return line.strip(), {}

    with patch("app.api.openai.get_adapter", return_value=SlowOpenAdapter()):
        # need to seed model cache for validation
        MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
        # start stream
        async def start():
            return await client.post(
                "/v1/chat/completions",
                headers=headers,
                json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "stream": True},
            )

        task = asyncio.create_task(start())
        await asyncio.sleep(0.5)
        # registry should have completion_id
        assert process_registry.size() >= 1
        keys = list(process_registry._map.keys())
        # completion_id starts with chatcmpl-
        comp_ids = [k for k in keys if k.startswith("chatcmpl-")]
        assert len(comp_ids) >= 1, f"expected chatcmpl key, got {keys}"
        comp_id = comp_ids[0]

        # cancel
        cancel_resp = await client.post(f"/v1/chat/completions/{comp_id}/cancel", headers=headers)
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled"

        await asyncio.sleep(0.3)
        assert process_registry.size() == 0

        stream_resp = await asyncio.wait_for(task, timeout=5)
        text = stream_resp.text
        assert "cancelled" in text.lower()
        assert "[DONE]" not in text

        # second cancel 404
        cancel2 = await client.post(f"/v1/chat/completions/{comp_id}/cancel", headers=headers)
        assert cancel2.status_code == 404


@pytest.mark.asyncio
async def test_openai_cancel_unknown_returns_404(client, db_session, regular_user):
    from app.core.security import generate_api_key
    from app.db.database import APIKey

    raw, prefix, digest = generate_api_key()
    key = APIKey(user_id=regular_user.id, name="k", key_prefix=prefix, key_hash=digest)
    db_session.add(key)
    await db_session.commit()
    headers = {"Authorization": f"Bearer {raw}"}
    resp = await client.post("/v1/chat/completions/does-not-exist/cancel", headers=headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cancel_is_idempotent_and_cleans_up(client, user_headers):
    # create conv
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]
    with patch("app.api.chat.get_adapter", return_value=SlowAdapter()):
        task = asyncio.create_task(
            client.post(f"/api/chat/conversations/{conv_id}/messages/stream", headers=user_headers, json={"content": "hi"})
        )
        await asyncio.sleep(0.5)
        # first cancel
        r1 = await client.post(f"/api/chat/conversations/{conv_id}/cancel", headers=user_headers)
        assert r1.status_code == 200
        # second cancel should be 404 (already cleaned)
        r2 = await client.post(f"/api/chat/conversations/{conv_id}/cancel", headers=user_headers)
        assert r2.status_code == 404
        # wait task
        try:
            await asyncio.wait_for(task, timeout=5)
        except asyncio.TimeoutError:
            task.cancel()
            pytest.fail("task timeout")
        assert process_registry.size() == 0
