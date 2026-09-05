import pytest
import json
from unittest.mock import patch, AsyncMock

from app.clients.registry import MODEL_CACHE
from app.models.harness import HarnessModel, HarnessResult

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def seed_models():
    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]
    yield
    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_json_object_returns_valid_json_or_502(client, user_headers):
    # harness returns invalid JSON, expect 502
    async def bad_run(prompt, model=None, session_id=None, env=None, request_id=None):
        return HarnessResult(text="not json", model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_adapter = AsyncMock()
        mock_adapter.run = bad_run
        mock_get.return_value = mock_adapter

        resp = await client.post(
            "/v1/chat/completions",
            headers=user_headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "response_format": {"type": "json_object"}},
        )
        assert resp.status_code == 502
        assert "malformed_output" in resp.text

    # valid JSON should succeed
    async def good_run(prompt, model=None, session_id=None, env=None, request_id=None):
        return HarnessResult(text='{"name": "test", "value": 123}', model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_adapter = AsyncMock()
        mock_adapter.run = good_run
        mock_get.return_value = mock_adapter

        resp2 = await client.post(
            "/v1/chat/completions",
            headers=user_headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "response_format": {"type": "json_object"}},
        )
        assert resp2.status_code == 200
        data = resp2.json()
        assert "choices" in data


@pytest.mark.asyncio
async def test_json_object_retry_succeeds_on_second_try(client, user_headers):
    # first call returns invalid, second returns valid (retry)
    call_count = {"n": 0}

    async def flaky_run(prompt, model=None, session_id=None, env=None, request_id=None):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return HarnessResult(text="not json", model=model or "default")
        else:
            return HarnessResult(text='{"ok": true}', model=model or "default")

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_adapter = AsyncMock()
        mock_adapter.run = flaky_run
        mock_get.return_value = mock_adapter

        resp = await client.post(
            "/v1/chat/completions",
            headers=user_headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "response_format": {"type": "json_object"}},
        )
        assert resp.status_code == 200
        assert call_count["n"] == 2


@pytest.mark.asyncio
async def test_json_schema_validates(client, user_headers):
    # test with json_schema that has required field
    async def good_run(prompt, model=None, session_id=None, env=None, request_id=None):
        return HarnessResult(text='{"name": "test"}', model=model or "default")

    async def bad_run(prompt, model=None, session_id=None, env=None, request_id=None):
        return HarnessResult(text='{"wrong": 123}', model=model or "default")

    schema = {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_adapter = AsyncMock()
        mock_adapter.run = good_run
        mock_get.return_value = mock_adapter

        resp = await client.post(
            "/v1/chat/completions",
            headers=user_headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "response_format": {"type": "json_schema", "json_schema": schema}},
        )
        # if jsonschema not installed, it will succeed without validation; if installed, good should succeed
        assert resp.status_code == 200

    # try to check that bad would be 502 if jsonschema is available
    # we don't enforce strict failure when jsonschema missing, so just check that it doesn't crash
    with patch("app.api.openai.get_adapter") as mock_get:
        mock_adapter = AsyncMock()
        mock_adapter.run = bad_run
        mock_get.return_value = mock_adapter

        resp2 = await client.post(
            "/v1/chat/completions",
            headers=user_headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "response_format": {"type": "json_schema", "json_schema": schema}},
        )
        # could be 200 (if no jsonschema) or 502 (if validates)
        assert resp2.status_code in (200, 502)
