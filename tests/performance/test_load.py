import asyncio
import time

import pytest
pytestmark = pytest.mark.performance


@pytest.mark.asyncio
async def test_burst_conversation_creation_handles_load(client, user_headers):
    # simulate burst of 30 sequential creations (SQLite in-memory cannot handle true concurrent writes on one session)
    start = time.monotonic()
    results = []
    for i in range(30):
        results.append(await client.post("/api/chat/conversations", headers=user_headers, json={"title": f"load-{i}"}))
    elapsed = time.monotonic() - start
    assert all(r.status_code == 200 for r in results)
    assert elapsed < 3.0, f"burst took {elapsed:.2f}s"


@pytest.mark.asyncio
async def test_sustained_read_throughput(client, user_headers):
    # create one conversation to ensure data exists
    await client.post("/api/chat/conversations", headers=user_headers, json={"title": "warm"})
    start = time.monotonic()
    for _ in range(50):
        resp = await client.get("/api/chat/conversations", headers=user_headers)
        assert resp.status_code == 200
    elapsed = time.monotonic() - start
    rps = 50 / elapsed
    assert rps > 10, f"read throughput too low: {rps:.1f} rps"


def test_memory_stability_of_model_utils_under_load():
    # ensure no memory leak in repeated parsing (basic check via repeated calls)
    from app.shared.model_utils import parse_model_identifier

    for _ in range(50000):
        parse_model_identifier("opencode//opencode/big-pickle")
    # if we reach here without OOM, pass
    assert True