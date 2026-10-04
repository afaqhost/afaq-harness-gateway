"""Unit tests for production hardening task 5: remove blocking Redis I/O from async paths."""

from __future__ import annotations

import ast
import asyncio
from collections import deque
import json
from pathlib import Path
import time
import warnings
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError, RedisError, TimeoutError as RedisTimeoutError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.clients.base import HarnessAdapter
from app.clients.registry import MODEL_CACHE, cached_models, cached_models_clear, refresh_models
from app.core.config import get_settings, settings
from app.core.redis import REDIS_EXCEPTIONS, RedisProvider, close_redis, get_redis_client, get_redis_provider
from app.middleware.rate_limit import RedisRateLimiter
from app.models.harness import HarnessModel
from app.services.harness_job_service import HarnessJob, HarnessJobService, _json_to_job
from app.transport.history import HistoryStore, RedisHistoryStore

pytestmark = pytest.mark.unit


class FakePipeline:
    def __init__(self, store: dict[str, list[str]]):
        self._store = store
        self.ops: list[tuple] = []

    def lpush(self, key: str, val: str):
        self.ops.append(("lpush", key, val))
        if key not in self._store:
            self._store[key] = []
        self._store[key].insert(0, val)
        return self

    def ltrim(self, key: str, start: int, stop: int):
        self.ops.append(("ltrim", key, start, stop))
        if key in self._store:
            end = stop + 1 if stop >= 0 else len(self._store[key])
            self._store[key] = self._store[key][start:end]
        return self

    def expire(self, key: str, ttl: int):
        self.ops.append(("expire", key, ttl))
        return self

    async def execute(self):
        results = []
        for op in self.ops:
            results.append(1)
        return results

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return None


class FakeAsyncRedis:
    def __init__(self):
        self.store: dict[str, list[str]] = {}
        self.kv: dict[str, str] = {}
        self.deleted_keys: list[str] = []
        self.pipeline_calls: list[FakePipeline] = []

    def pipeline(self, transaction: bool = True):
        pipe = FakePipeline(self.store)
        self.pipeline_calls.append(pipe)
        return pipe

    async def eval(self, script: str, numkeys: int, *keys_and_args):
        # Emulate atomic Lua script: increment key, set ttl if 1, return {count, ttl}
        key = keys_and_args[0]
        window_s = int(keys_and_args[1]) if len(keys_and_args) > 1 else 60
        cur = int(self.kv.get(key, 0)) + 1
        self.kv[key] = str(cur)
        return [cur, window_s]

    async def lrange(self, key: str, start: int, stop: int):
        if key not in self.store:
            return []
        items = self.store[key]
        end = stop + 1 if stop >= 0 else len(items)
        return list(items[start:end])

    async def exists(self, key: str):
        return 1 if (key in self.store and self.store[key]) or (key in self.kv) else 0

    async def set(self, key: str, value: str, ex: int | None = None):
        self.kv[key] = value
        return True

    async def expire(self, key: str, time: int):
        return True

    async def get(self, key: str):
        return self.kv.get(key)

    async def delete(self, *keys: str):
        for k in keys:
            self.deleted_keys.append(k)
            self.store.pop(k, None)
            self.kv.pop(k, None)
        return len(keys)

    async def scan_iter(self, match: str = "*", count: int = 100):
        import fnmatch

        all_keys = list(self.store.keys()) + list(self.kv.keys())
        for k in all_keys:
            if fnmatch.fnmatch(k, match):
                yield k

    async def aclose(self):
        pass


def test_no_production_module_imports_sync_redis():
    """Ensure no production code in app/ imports or constructs the synchronous redis client."""
    app_dir = Path("app")
    violations = []

    for py_file in app_dir.rglob("*.py"):
        code = py_file.read_text(encoding="utf-8")
        tree = ast.parse(code, filename=str(py_file))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "redis":
                        violations.append(f"{py_file}:{node.lineno} imports 'redis' directly")
            elif isinstance(node, ast.ImportFrom):
                if node.module == "redis":
                    # only redis.asyncio or redis.exceptions are acceptable
                    for alias in node.names:
                        if alias.name not in ("asyncio", "exceptions"):
                            violations.append(f"{py_file}:{node.lineno} imports '{alias.name}' from 'redis'")

    assert not violations, f"Synchronous redis imports found in production code:\n" + "\n".join(violations)


@pytest.mark.asyncio
async def test_async_history_pipeline_order_and_bounded_length():
    """Async history append/replay/exists/clear preserve order and bounded length with pipelining."""
    fake_client = FakeAsyncRedis()
    store = RedisHistoryStore(maxlen=3, client=fake_client)

    # Append 5 events: 1, 2, 3, 4, 5
    for i in range(1, 6):
        await store.append("stream_1", i, f"payload_{i}")

    # Verify pipeline was used and awaited for each append
    assert len(fake_client.pipeline_calls) == 5
    for pipe in fake_client.pipeline_calls:
        op_names = [op[0] for op in pipe.ops]
        assert "lpush" in op_names
        assert "ltrim" in op_names
        assert "expire" in op_names

    # Check bounded length (maxlen=3): only 3 items remain in Redis
    rk = "history:stream_1"
    assert len(fake_client.store[rk]) == 3

    # Exists check
    assert await store.exists("stream_1") is True
    assert await store.size("stream_1") == 3

    # Replay from last_id=2 (should yield payload_3, payload_4, payload_5 in chronological order)
    replayed = await store.replay("stream_1", last_id=2)
    assert replayed == ["payload_3", "payload_4", "payload_5"]

    # Replay from last_id=4
    replayed_recent = await store.replay("stream_1", last_id=4)
    assert replayed_recent == ["payload_5"]

    # Clear check
    await store.clear()
    assert await store.exists("stream_1") is False


@pytest.mark.asyncio
async def test_in_memory_history_store_unconditionally_async():
    """In-memory HistoryStore has unconditionally async interface."""
    store = HistoryStore(maxlen=5)

    await store.append("s1", 1, "e1")
    await store.append("s1", 2, "e2")

    assert await store.exists("s1") is True
    assert await store.size("s1") == 2
    assert store.local_size("s1") == 2

    replayed = await store.replay("s1", 1)
    assert replayed == ["e2"]

    hist = await store.get_history("s1")
    assert len(hist) == 2

    await store.clear()
    assert await store.exists("s1") is False


@pytest.mark.asyncio
async def test_slow_failing_redis_falls_back_without_blocking():
    """Redis failures or timeouts gracefully fall back to in-memory without raising or blocking."""
    failing_client = MagicMock()
    pipe_mock = MagicMock()
    pipe_mock.execute = AsyncMock(side_effect=RedisTimeoutError("Connection timed out"))
    failing_client.pipeline = MagicMock(return_value=pipe_mock)
    failing_client.lrange = AsyncMock(side_effect=RedisConnectionError("Redis connection refused"))
    failing_client.exists = AsyncMock(side_effect=asyncio.TimeoutError())

    store = RedisHistoryStore(maxlen=10, client=failing_client)

    # Append falls back to in-memory without raising
    await store.append("stream_fail", 1, "data_1")
    await store.append("stream_fail", 2, "data_2")

    # Exists falls back to in-memory
    assert await store.exists("stream_fail") is True

    # Replay falls back to in-memory
    replayed = await store.replay("stream_fail", last_id=0)
    assert replayed == ["data_1", "data_2"]


def test_model_cache_request_reads_are_local_and_non_blocking():
    """cached_models() serves the local hot cache synchronously without network/Redis calls."""
    MODEL_CACHE.clear()
    test_models = [HarnessModel(id="claude//claude-sonnet-4", harness="claude", provider="anthropic", name="claude-sonnet-4")]
    MODEL_CACHE["claude"] = test_models

    # Request-time call is completely synchronous and non-blocking
    result = cached_models("claude")
    assert result == test_models
    assert cached_models("unknown") == []

    cached_models_clear("claude")
    assert cached_models("claude") == []


@pytest.mark.asyncio
async def test_model_cache_local_success_overrides_redis(test_engine):
    """Local discovery is authoritative when it succeeds, overriding stale Redis mirror and updating it."""
    fake_client = FakeAsyncRedis()
    provider = get_redis_provider()
    provider.set_client(fake_client)

    MODEL_CACHE.clear()

    # Prepopulate stale Redis mirror
    old_models = [{"id": "dummy//m_old", "harness": "dummy", "provider": "p", "name": "m_old"}]
    fake_client.kv["models:dummy_harness"] = json.dumps(old_models)

    # Local adapter discovers m_new
    dummy_adapter = MagicMock()
    dummy_adapter.name = "dummy_harness"
    dummy_adapter.display_name = "Dummy Harness"
    dummy_adapter.executable = "dummy"
    dummy_adapter.provider = "dummy"
    dummy_adapter.is_installed.return_value = True
    new_models = [HarnessModel(id="dummy_harness//m_new", harness="dummy_harness", provider="dummy", name="m_new")]
    dummy_adapter.list_models = AsyncMock(return_value=new_models)

    test_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    with (
        patch("app.clients.registry.all_adapters", return_value=[dummy_adapter]),
        patch("app.db.database.SessionLocal", test_session_factory),
    ):
        await refresh_models()

        # Local discovery wins over stale Redis
        assert MODEL_CACHE["dummy_harness"] == new_models

        # Redis mirror was updated to new models
        redis_raw = fake_client.kv.get("models:dummy_harness")
        assert redis_raw is not None
        dicts = json.loads(redis_raw)
        assert dicts[0]["id"] == "dummy_harness//m_new"

    await close_redis()


@pytest.mark.asyncio
async def test_model_cache_local_failure_hydrates_from_redis_without_deleting_mirror(test_engine):
    """Transient local discovery failure hydrates from Redis mirror and does not delete the valid shared mirror."""
    fake_client = FakeAsyncRedis()
    provider = get_redis_provider()
    provider.set_client(fake_client)

    MODEL_CACHE.clear()

    # Valid shared mirror in Redis
    valid_mirror = [{"id": "dummy_harness//m_shared", "harness": "dummy_harness", "provider": "dummy", "name": "m_shared"}]
    fake_client.kv["models:dummy_harness"] = json.dumps(valid_mirror)

    # Local adapter discovery fails transiently
    dummy_adapter = MagicMock()
    dummy_adapter.name = "dummy_harness"
    dummy_adapter.display_name = "Dummy Harness"
    dummy_adapter.executable = "dummy"
    dummy_adapter.provider = "dummy"
    dummy_adapter.is_installed.return_value = True
    dummy_adapter.list_models = AsyncMock(side_effect=RuntimeError("Transient CLI discovery timeout"))

    test_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    with (
        patch("app.clients.registry.all_adapters", return_value=[dummy_adapter]),
        patch("app.db.database.SessionLocal", test_session_factory),
    ):
        await refresh_models()

        # Local cache is hydrated from shared Redis mirror
        assert len(MODEL_CACHE["dummy_harness"]) == 1
        assert MODEL_CACHE["dummy_harness"][0].id == "dummy_harness//m_shared"

        # Valid shared mirror was NOT deleted
        assert "models:dummy_harness" in fake_client.kv
        assert "models:dummy_harness" not in fake_client.deleted_keys

    await close_redis()


@pytest.mark.asyncio
async def test_harness_job_service_uses_awaited_redis_and_releases_lock():
    """HarnessJobService mirrors and reads jobs via awaited async Redis without holding lock."""
    fake_client = FakeAsyncRedis()
    provider = get_redis_provider()
    provider.set_client(fake_client)

    service = HarnessJobService(ttl_seconds=0.01)

    adapter = MagicMock()
    adapter.name = "test_tool"
    async def mock_gen(on_process=None):
        yield {"stage": "completed", "message": "done", "exit_code": 0}
    adapter.install = MagicMock(return_value=mock_gen())

    # Start install mirrors to Redis and does not hold lock across I/O
    job = await service.start_install(adapter)
    assert not service._lock.locked(), "Service lock must not be held across network I/O"

    # Verify mirrored in fake Redis
    raw = fake_client.kv.get(f"job:{job.id}")
    assert raw is not None
    job_data = json.loads(raw)
    assert job_data["id"] == job.id
    assert job_data["harness"] == "test_tool"

    # Local get returns in-memory job
    fetched = await service.get(job.id)
    assert fetched is not None
    assert fetched.id == job.id

    # If cleared from local memory, fallback to Redis read outside lock
    async with service._lock:
        service._jobs.clear()

    cross_pod_job = await service.get(job.id)
    assert not service._lock.locked()
    assert cross_pod_job is not None
    assert cross_pod_job.id == job.id
    assert cross_pod_job.harness == "test_tool"

    # Wait for background expire task to run and delete from Redis
    await asyncio.sleep(0.05)
    assert f"job:{job.id}" in fake_client.deleted_keys

    await close_redis()


def test_json_to_job_handles_malformed_data():
    """_json_to_job catches JSONDecodeError, ValueError, TypeError, KeyError and returns None safely."""
    assert _json_to_job("not a valid json") is None
    assert _json_to_job("[]") is None
    assert _json_to_job('{"created_at": "not-a-float"}') is None
    assert _json_to_job('{"updated_at": "invalid"}') is None


@pytest.mark.asyncio
async def test_rate_limiter_reset_is_local_only_and_creates_no_tasks():
    """Rate limiter reset() is local-only, creates no tasks, and never flushes Redis."""
    fake_client = FakeAsyncRedis()
    fake_client.flushdb = MagicMock(side_effect=AssertionError("FLUSHDB must never be called!"))

    limiter = RedisRateLimiter(client=fake_client)

    # Initial allow creates state in memory and Redis
    tasks_before = len(asyncio.all_tasks())

    # Call reset
    limiter.reset()

    tasks_after = len(asyncio.all_tasks())
    assert tasks_after == tasks_before, "reset() must not schedule orphan background tasks"
    assert fake_client.flushdb.call_count == 0, "reset() must never flush Redis"

    # Explicit awaited helper targets only rl:* keys
    fake_client.kv["rl:user1:123"] = "1"
    fake_client.kv["models:claude"] = "should_not_touch"
    await limiter.clear_redis_rate_limits()

    assert "rl:user1:123" in fake_client.deleted_keys
    assert "models:claude" not in fake_client.deleted_keys


@pytest.mark.asyncio
async def test_rate_limiter_shadow_bucket_persists_across_redis_failure():
    """Admit requests through Redis, then make Redis time out; next over-limit request is denied locally."""
    fake_client = FakeAsyncRedis()
    limiter = RedisRateLimiter(client=fake_client)

    # Limit = 2 per 60s
    # 1. Admit 1st request through Redis
    allowed1, _ = await limiter.async_allow("shadow_key", limit=2, window_s=60)
    assert allowed1 is True

    # 2. Admit 2nd request through Redis
    allowed2, _ = await limiter.async_allow("shadow_key", limit=2, window_s=60)
    assert allowed2 is True

    # 3. Simulate sudden Redis outage / timeout
    fake_client.eval = AsyncMock(side_effect=RedisTimeoutError("Connection timed out"))

    # 4. 3rd request occurs during outage.
    # The local shadow bucket was kept active on requests 1 & 2, so it knows the replica
    # has already reached 2 requests. The 3rd request MUST be denied locally!
    allowed3, retry_after = await limiter.async_allow("shadow_key", limit=2, window_s=60)
    assert allowed3 is False, "Local shadow bucket must prevent over-limit bypass when Redis fails"
    assert retry_after >= 1


@pytest.mark.asyncio
async def test_rate_limiter_fallback_does_not_fail_open():
    """When Redis fails or times out, rate limiter falls back to in-memory enforcement (does not fail open)."""
    failing_client = MagicMock()
    failing_client.eval = AsyncMock(side_effect=RedisTimeoutError("Redis timed out"))

    limiter = RedisRateLimiter(client=failing_client)

    # With limit=2 and window=60s:
    allowed1, _ = await limiter.async_allow("ip:1.2.3.4", limit=2, window_s=60)
    assert allowed1 is True

    allowed2, _ = await limiter.async_allow("ip:1.2.3.4", limit=2, window_s=60)
    assert allowed2 is True

    # 3rd request must be blocked by the in-memory fallback, not fail open!
    allowed3, retry_after = await limiter.async_allow("ip:1.2.3.4", limit=2, window_s=60)
    assert allowed3 is False
    assert retry_after >= 1


def test_test_suite_isolated_from_live_redis(isolate_external_redis):
    """The test suite autouse fixture isolates settings and prevents connection to external Redis."""
    assert settings.redis_enabled is False
    assert settings.redis_url == ""


@pytest.mark.asyncio
async def test_no_unawaited_coroutine_warnings():
    """Verify that history, rate limiter, and job service operations emit zero un-awaited coroutine warnings."""
    fake_client = FakeAsyncRedis()
    history = RedisHistoryStore(client=fake_client)
    limiter = RedisRateLimiter(client=fake_client)

    with warnings.catch_warnings(record=True) as captured_warnings:
        warnings.simplefilter("always")

        await history.append("warn_stream", 1, "chunk")
        await history.replay("warn_stream", last_id=0)
        await history.exists("warn_stream")
        await history.clear()

        await limiter.async_allow("warn_user", limit=10, window_s=60)
        limiter.reset()

        unawaited = [w for w in captured_warnings if "was never awaited" in str(w.message)]
        assert len(unawaited) == 0, f"Unawaited coroutines detected: {[str(w.message) for w in unawaited]}"


@pytest.mark.asyncio
async def test_application_lifespan_awaits_redis_close():
    """Lifespan awaits close_redis() during shutdown."""
    from app.main import lifespan, app

    provider = get_redis_provider()
    fake_client = FakeAsyncRedis()
    fake_client.aclose = AsyncMock()
    provider.set_client(fake_client)

    with patch("app.main.init_db", new_callable=AsyncMock), \
         patch("app.main.credential_service.harvest_env_credentials", new_callable=AsyncMock), \
         patch("app.main.refresh_models", new_callable=AsyncMock):
        async with lifespan(app):
            pass

    assert fake_client.aclose.await_count == 1
    await close_redis()
