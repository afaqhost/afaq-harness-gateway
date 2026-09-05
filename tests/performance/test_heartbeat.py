import pytest
import asyncio
from unittest.mock import patch

from app.clients.registry import MODEL_CACHE
from app.core.config import settings
from app.models.harness import HarnessModel

pytestmark = pytest.mark.performance


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    yield
    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_heartbeat_appears_when_slow(client, user_headers):
    # reduce heartbeat to 1s for fast test
    old = settings.sse_heartbeat_seconds
    settings.sse_heartbeat_seconds = 1
    try:
        async def slow_stream(prompt, model=None, session_id=None, env=None, request_id=None):
            # sleep 2s (just over one heartbeat interval) then yield
            await asyncio.sleep(2)
            yield "late", {}

        with patch("app.api.chat.get_adapter") as mock_get:
            mock_get.return_value.stream = slow_stream
            resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
            conv_id = resp.json()["id"]
            start = asyncio.get_event_loop().time()
            resp2 = await client.post(f"/api/chat/conversations/{conv_id}/messages/stream", headers=user_headers, json={"content": "hi"})
            elapsed = asyncio.get_event_loop().time() - start
            assert resp2.status_code == 200
            text = resp2.text
            assert ": keepalive" in text, f"expected keepalive, got {text}"
            assert "event: token" in text
            # should have taken at least heartbeat interval
            assert elapsed >= 1
    finally:
        settings.sse_heartbeat_seconds = old
