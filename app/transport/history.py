"""SSE history store — transport-owned replay buffer.

Extracted from `app/services/process_registry.py:32` so the registry owns
only process lifecycle while transport owns wire replay (heartbeat/reconnect).
Behavior identical: per-key deque(maxlen=100) of (seq, payload).
"""

from __future__ import annotations

from collections import defaultdict, deque


class HistoryStore:
    """In-memory fallback — same semantics as Redis variant."""

    def __init__(self, maxlen: int = 100) -> None:
        self._store: dict[str, deque[tuple[int, str]]] = defaultdict(lambda: deque(maxlen=maxlen))
        self._maxlen = maxlen

    def append(self, key: str, seq: int, payload: str) -> None:
        self._store[key].append((seq, payload))

    def replay(self, key: str, last_id: int) -> list[str]:
        dq = self._store.get(key)
        if not dq:
            return []
        return [payload for seq, payload in dq if seq > last_id]

    def get_history(self, key: str) -> deque[tuple[int, str]]:
        return self._store.get(key, deque())

    def clear(self) -> None:
        self._store.clear()

    def size(self, key: str | None = None) -> int:
        if key is not None:
            return len(self._store.get(key, []))
        return sum(len(v) for v in self._store.values())


class RedisHistoryStore:
    """Redis-backed history — `LPUSH` + `LTRIM 100` + `LRANGE`.

    Falls back to in-memory `HistoryStore` if Redis is unavailable so tests
    remain green without a running Redis.
    """

    def __init__(self, redis_url: str, maxlen: int = 100) -> None:
        self._maxlen = maxlen
        self._fallback = HistoryStore(maxlen=maxlen)
        self._client = None
        self._available = False
        try:
            import redis.asyncio as redis  # type: ignore

            # sync client for now (history is sync in current call sites)
            import redis as sync_redis  # type: ignore

            self._client = sync_redis.from_url(redis_url, decode_responses=True)
            # probe
            self._client.ping()
            self._available = True
        except Exception:
            self._client = None
            self._available = False

    def _key(self, key: str) -> str:
        return f"history:{key}"

    def append(self, key: str, seq: int, payload: str) -> None:
        if not self._available or self._client is None:
            return self._fallback.append(key, seq, payload)
        try:
            rk = self._key(key)
            # store as "seq|payload" to keep ordering and filtering by seq
            self._client.lpush(rk, f"{seq}|{payload}")
            self._client.ltrim(rk, 0, self._maxlen - 1)
            self._client.expire(rk, 3600)
        except Exception:
            self._fallback.append(key, seq, payload)

    def replay(self, key: str, last_id: int) -> list[str]:
        if not self._available or self._client is None:
            return self._fallback.replay(key, last_id)
        try:
            rk = self._key(key)
            items = self._client.lrange(rk, 0, -1)
            # items are newest first (LPUSH), reverse to oldest first
            result: list[str] = []
            for item in reversed(items):
                try:
                    seq_str, payload = item.split("|", 1)
                    if int(seq_str) > last_id:
                        result.append(payload)
                except ValueError:
                    continue
            return result
        except Exception:
            return self._fallback.replay(key, last_id)

    def get_history(self, key: str) -> deque[tuple[int, str]]:
        if not self._available or self._client is None:
            return self._fallback.get_history(key)
        try:
            rk = self._key(key)
            items = self._client.lrange(rk, 0, -1)
            dq: deque[tuple[int, str]] = deque(maxlen=self._maxlen)
            for item in reversed(items):
                try:
                    seq_str, payload = item.split("|", 1)
                    dq.append((int(seq_str), payload))
                except ValueError:
                    continue
            return dq
        except Exception:
            return self._fallback.get_history(key)

    def clear(self) -> None:
        self._fallback.clear()
        if self._client:
            try:
                # best-effort flush history keys
                for k in list(self._client.scan_iter("history:*")):
                    self._client.delete(k)
            except Exception:
                pass

    def size(self, key: str | None = None) -> int:
        if key is not None:
            return len(self.get_history(key))
        # approximate
        return self._fallback.size(key)


def get_history_store() -> HistoryStore | RedisHistoryStore:
    try:
        from app.core.config import get_settings

        s = get_settings()
        if s.redis_enabled and s.redis_url:
            return RedisHistoryStore(s.redis_url)
    except Exception:
        pass
    return HistoryStore()


# singleton used by transport/stream — auto-chooses based on settings
history_store = get_history_store()
