import pytest

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_metrics_returns_200(client):
    resp = await client.get("/metrics")
    # if prometheus not installed, would be 501, but we installed it
    assert resp.status_code == 200
    text = resp.text
    # should contain some metric
    assert "afaq" in text or "harness" in text or "python" in text.lower() or "process" in text.lower()


@pytest.mark.asyncio
async def test_metrics_contains_harness_calls_after_request(client, user_headers):
    # make a harness call to generate metric
    from unittest.mock import patch
    from app.models.harness import HarnessResult

    async def fake_run(prompt, model=None, session_id=None, env=None, request_id=None):
        return HarnessResult(text="ok", model=model or "default")

    # create conv and send message
    resp = await client.post("/api/chat/conversations", headers=user_headers, json={"model": "opencode//opencode/big-pickle"})
    conv_id = resp.json()["id"]
    with patch("app.api.chat.get_adapter") as mock_get:
        mock_get.return_value.run = fake_run
        await client.post(f"/api/chat/conversations/{conv_id}/messages", headers=user_headers, json={"content": "hello"})

    # now metrics should contain harness_calls
    resp2 = await client.get("/metrics")
    assert resp2.status_code == 200
    text = resp2.text
    assert "harness_calls" in text or "afaq_harness" in text


@pytest.mark.asyncio
async def test_metrics_without_prometheus_returns_501_or_200(client, monkeypatch):
    # simulate missing prometheus by monkeypatching _PROM_AVAILABLE false
    import app.api.metrics as m
    orig = m._PROM_AVAILABLE
    m._PROM_AVAILABLE = False
    try:
        resp = await client.get("/metrics")
        assert resp.status_code == 501
    finally:
        m._PROM_AVAILABLE = orig
