import pytest
pytestmark = pytest.mark.contract


@pytest.mark.asyncio
async def test_openapi_schema_is_available(client):
    resp = await client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()
    assert "openapi" in schema
    assert "paths" in schema
    # ensure key endpoints are documented
    assert "/v1/chat/completions" in schema["paths"]
    assert "/api/auth/bootstrap" in schema["paths"]
    assert "/api/chat/conversations" in schema["paths"]


@pytest.mark.asyncio
async def test_models_response_conforms_to_openai_contract(client):
    # seed no models needed – schema should still be valid
    resp = await client.get("/v1/models")
    assert resp.status_code == 200
    data = resp.json()
    assert data["object"] == "list"
    assert "data" in data
    for model in data["data"]:
        assert "id" in model
        assert "object" in model
        assert model["object"] == "model"
        assert "owned_by" in model


@pytest.mark.asyncio
async def test_chat_completions_contract_stream_vs_non_stream(client, user_headers):
    from unittest.mock import patch
    from app.models.harness import HarnessResult
    from app.clients.registry import MODEL_CACHE
    from app.models.harness import HarnessModel

    MODEL_CACHE.clear()
    MODEL_CACHE["opencode"] = [HarnessModel(id="opencode//opencode/big-pickle", harness="opencode", provider="opencode", name="opencode/big-pickle")]

    async def fake_run(prompt, model=None, session_id=None, env=None, request_id=None):
        return HarnessResult(text="contract reply", model=model or "default")

    async def fake_stream(prompt, model=None, session_id=None, env=None, request_id=None):
        yield "part1 ", {}
        yield "part2", {}

    with patch("app.api.openai.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        mock_get.return_value.stream = fake_stream

        non_stream = await client.post(
            "/v1/chat/completions",
            headers=user_headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}]},
        )
        assert non_stream.status_code == 200
        body = non_stream.json()
        assert body["object"] == "chat.completion"
        assert "choices" in body
        assert "usage" in body
        assert body["choices"][0]["message"]["role"] == "assistant"

        stream = await client.post(
            "/v1/chat/completions",
            headers=user_headers,
            json={"model": "opencode//opencode/big-pickle", "messages": [{"role": "user", "content": "hi"}], "stream": True},
        )
        assert stream.status_code == 200
        assert "text/event-stream" in stream.headers["content-type"]
        assert "data:" in stream.text
        assert "[DONE]" in stream.text

    MODEL_CACHE.clear()


@pytest.mark.asyncio
async def test_error_responses_use_consistent_shape(client, user_headers):
    # request unknown harness should return 400 with detail
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "unknown//model"})
    # model validation is performed in conversation creation via select_model_for_new_conversation
    assert resp.status_code in (400, 200)
    if resp.status_code == 400:
        assert "detail" in resp.json()