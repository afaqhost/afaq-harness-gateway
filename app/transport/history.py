"""SSE history store — transport-owned replay buffer.

Extracted from `app/services/process_registry.py:32` so the registry owns
only process lifecycle while transport owns wire replay (heartbeat/reconnect).
Behavior identical: per-key deque(maxlen=100) of (seq, payload).
"""

from __future__ import annotations

from collections import defaultdict, deque
import logging

from app.core.redis import REDIS_EXCEPTIONS, get_redis_client

logger = logging.getLogger("afaq")


class HistoryStore:
    """In-memory history store — unconditionally async interface identical to RedisHistoryStore."""

    def __init__(self, maxlen: int = 100) -> None:
        self._store: dict[str, deque[tuple[int, str]]] = defaultdict(lambda: deque(maxlen=maxlen))
        self._maxlen = maxlen

    async def append(self, key: str, seq: int, payload: str) -> None:
        self._store[key].append((seq, payload))

    async def replay(self, key: str, last_id: int) -> list[str]:
        dq = self._store.get(key)
        if not dq:
            return []
        return [payload for seq, payload in dq if seq > last_id]

    async def get_history(self, key: str) -> deque[tuple[int, str]]:
        dq = self._store.get(key)
        if dq is None:
            return deque(maxlen=self._maxlen)
        return deque(dq, maxlen=self._maxlen)

    async def clear(self) -> None:
        self._store.clear()

    async def exists(self, key: str) -> bool:
        return key in self._store and len(self._store[key]) > 0

    async def size(self, key: str | None = None) -> int:
        return self.local_size(key)

    def local_size(self, key: str | None = None) -> int:
        """Synchronous local-only size check."""
        if key is not None:
            return len(self._store.get(key, []))
        return sum(len(v) for v in self._store.values())


class RedisHistoryStore:
    """Redis-backed history using redis.asyncio — pipelined `LPUSH` + `LTRIM` + `EXPIRE`.

    Falls back to in-memory `HistoryStore` if Redis is unavailable.
    """

    def __init__(self, redis_url: str | None = None, maxlen: int = 100, ttl: int = 3600, client=None) -> None:
        self._maxlen = maxlen
        self._ttl = ttl
        self._fallback = HistoryStore(maxlen=maxlen)
        self._custom_client = client

    def _key(self, key: str) -> str:
        return f"history:{key}"

    async def _get_client(self):
        if self._custom_client is not None:
            return self._custom_client
        return await get_redis_client()

    async def append(self, key: str, seq: int, payload: str) -> None:
        client = await self._get_client()
        if client is None:
            await self._fallback.append(key, seq, payload)
            return

        try:
            rk = self._key(key)
            pipe = client.pipeline(transaction=True)
            pipe.lpush(rk, f"{seq}|{payload}")
            pipe.ltrim(rk, 0, self._maxlen - 1)
            pipe.expire(rk, self._ttl)
            await pipe.execute()
        except REDIS_EXCEPTIONS as exc:
            logger.warning("redis_append_fallback error=%s", exc)
            await self._fallback.append(key, seq, payload)

    async def replay(self, key: str, last_id: int) -> list[str]:
        client = await self._get_client()
        if client is None:
            return await self._fallback.replay(key, last_id)

        try:
            rk = self._key(key)
            items = await client.lrange(rk, 0, -1)
            result: list[str] = []
            for item in reversed(items):
                try:
                    seq_str, payload = item.split("|", 1)
                    if int(seq_str) > last_id:
                        result.append(payload)
                except ValueError:
                    continue
            return result
        except REDIS_EXCEPTIONS as exc:
            logger.warning("redis_history_fallback error=%s", exc)
            return await self._fallback.replay(key, last_id)

    async def get_history(self, key: str) -> deque[tuple[int, str]]:
        client = await self._get_client()
        if client is None:
            return await self._fallback.get_history(key)

        try:
            rk = self._key(key)
            items = await client.lrange(rk, 0, -1)
            dq: deque[tuple[int, str]] = deque(maxlen=self._maxlen)
            for item in reversed(items):
                try:
                    seq_str, payload = item.split("|", 1)
                    dq.append((int(seq_str), payload))
                except ValueError:
                    continue
            return dq
        except REDIS_EXCEPTIONS as exc:
            logger.warning("redis_history_fallback error=%s", exc)
            return await self._fallback.get_history(key)

    async def clear(self) -> None:
        await self._fallback.clear()
        client = await self._get_client()
        if client is None:
            return

        try:
            keys: list[str] = []
            async for k in client.scan_iter(match="history:*", count=100):
                keys.append(k)
                if len(keys) >= 100:
                    await client.delete(*keys)
                    keys.clear()
            if keys:
                await client.delete(*keys)
        except REDIS_EXCEPTIONS as exc:
            logger.warning("history_clear_failed error=%s", exc)

    async def exists(self, key: str) -> bool:
        client = await self._get_client()
        if client is None:
            return await self._fallback.exists(key)

        try:
            rk = self._key(key)
            return bool(await client.exists(rk))
        except REDIS_EXCEPTIONS as exc:
            logger.warning("redis_exists_fallback error=%s", exc)
            return await self._fallback.exists(key)

    async def size(self, key: str | None = None) -> int:
        if key is not None:
            hist = await self.get_history(key)
            return len(hist)
        return self._fallback.local_size(key)

    def local_size(self, key: str | None = None) -> int:
        """Synchronous local-only size check."""
        return self._fallback.local_size(key)


def get_history_store() -> HistoryStore | RedisHistoryStore:
    try:
        from app.core.config import get_settings

        s = get_settings()
        if s.redis_enabled and s.redis_url:
            return RedisHistoryStore()
    except REDIS_EXCEPTIONS as exc:
        logger.warning("history_store_best_effort error=%s", exc)
    except Exception as exc:
        logger.warning("history_store_init_error error=%s", exc)
    return HistoryStore()


# singleton used by transport/stream — auto-chooses based on settings
history_store = get_history_store()
