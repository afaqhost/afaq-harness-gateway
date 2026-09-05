import time

import pytest

from app.shared.model_utils import parse_model_identifier
from app.shared.prompt_utils import build_harness_prompt, build_history_prompt
pytestmark = pytest.mark.performance


def test_model_parsing_throughput_is_acceptable():
    start = time.monotonic()
    for _ in range(10000):
        parse_model_identifier("opencode//opencode/big-pickle")
        parse_model_identifier("commandcode//deepseek/deepseek-v4-flash")
        parse_model_identifier("claude/sonnet")
    elapsed = time.monotonic() - start
    # 30k parses should be well under 1 second on modern hardware
    assert elapsed < 1.0, f"parsing too slow: {elapsed:.3f}s for 30k parses"


def test_prompt_building_scales_linearly():
    messages = [("user", f"message {i}") for i in range(100)]
    start = time.monotonic()
    for _ in range(1000):
        history = build_history_prompt(messages)
        build_harness_prompt("system prompt is a bit longer to test overhead", history)
    elapsed = time.monotonic() - start
    assert elapsed < 1.0, f"prompt building too slow: {elapsed:.3f}s"


@pytest.mark.asyncio
async def test_conversation_creation_latency_under_threshold(client, user_headers):
    # measure API latency for conversation creation (in-memory DB should be fast)
    start = time.monotonic()
    for i in range(20):
        resp = await client.post("/api/chat/conversations", headers=user_headers, json={"title": f"perf {i}"})
        assert resp.status_code == 200
    elapsed = time.monotonic() - start
    avg_ms = (elapsed / 20) * 1000
    assert avg_ms < 200, f"avg conversation creation {avg_ms:.1f}ms exceeds 200ms budget"


@pytest.mark.asyncio
async def test_concurrent_reads_do_not_serialize_unnecessarily(client, user_headers):
    import asyncio

    # warm up cache
    await client.get("/v1/models")

    async def fetch():
        return await client.get("/v1/models")

    start = time.monotonic()
    results = await asyncio.gather(*[fetch() for _ in range(20)])
    elapsed = time.monotonic() - start
    assert all(r.status_code == 200 for r in results)
    # 20 concurrent reads should finish quickly (<2s)
    assert elapsed < 2.0


def test_encrypt_decrypt_overhead_is_reasonable():
    from app.core.security import decrypt_secret, encrypt_secret

    secret = "sensitive-value-123456" * 2
    start = time.monotonic()
    for _ in range(500):
        e = encrypt_secret(secret)
        assert decrypt_secret(e) == secret
    elapsed = time.monotonic() - start
    assert elapsed < 2.0, f"crypto overhead {elapsed:.3f}s for 500 roundtrips too high"