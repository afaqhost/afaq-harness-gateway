"""Rate limiting middleware — in-memory token bucket.

Leaf layer: no import from services/. Supports injectable RateLimiter protocol
for prod Redis swap.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from typing import Protocol

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import settings

logger = logging.getLogger("afaq")


class RateLimiter(Protocol):
    def allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int]: ...
    def reset(self) -> None: ...


class InMemoryRateLimiter:
    """Simple sliding-window counter per key."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int]:
        now = time.monotonic()
        q = self._hits[key]
        # evict outside window
        while q and q[0] <= now - window_s:
            q.popleft()
        if len(q) >= limit:
            # retry after = oldest entry + window - now
            retry_after = int(q[0] + window_s - now) + 1
            if retry_after < 1:
                retry_after = 1
            return False, retry_after
        q.append(now)
        return True, 0

    def reset(self) -> None:
        self._hits.clear()

    # test helper
    def _size(self, key: str) -> int:
        return len(self._hits.get(key, []))


LUA_INCR_EXPIRE = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
"""


class RedisRateLimiter:
    """Redis fixed-window counter with atomic expiry and a local shadow bucket."""

    def __init__(self, redis_url: str | None = None, client=None) -> None:
        self._url = redis_url
        self._custom_client = client
        self._fallback = InMemoryRateLimiter()

    async def _get_client(self):
        if self._custom_client is not None:
            return self._custom_client
        from app.core.redis import get_redis_client

        return await get_redis_client()

    def allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int]:
        # Synchronous fallback interface
        return self._fallback.allow(key, limit, window_s)

    async def async_allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int]:
        # Always evaluate and record in local shadow bucket first.
        # This guarantees fail-safe continuity: if Redis times out or fails later,
        # the local bucket already contains all requests seen by this process replica.
        local_allowed, local_retry = self._fallback.allow(key, limit, window_s)

        client = await self._get_client()
        if client is None:
            return local_allowed, local_retry

        try:
            from app.core.redis import REDIS_EXCEPTIONS

            redis_key = f"rl:{key}:{int(time.time() // window_s)}"
            # Execute atomic INCR + EXPIRE via Lua script
            res = await client.eval(LUA_INCR_EXPIRE, 1, redis_key, window_s)
            count, ttl = int(res[0]), int(res[1])

            redis_allowed = (count <= limit)
            redis_retry = max(1, ttl) if not redis_allowed else 0

            # Combined decision: fallback/local shadowing cannot make enforcement more permissive
            if not local_allowed or not redis_allowed:
                return False, max(local_retry, redis_retry)
            return True, 0
        except REDIS_EXCEPTIONS as exc:
            logger.warning("redis_rate_limit_fallback error=%s", exc)
            return local_allowed, local_retry

    def reset(self) -> None:
        """Local-only reset. Never flushes Redis, schedules orphan tasks, or performs network I/O."""
        self._fallback.reset()

    async def clear_redis_rate_limits(self) -> None:
        """Explicit awaited test/admin helper to clear rl:* keys via SCAN+DELETE."""
        client = await self._get_client()
        if client is None:
            return
        try:
            from app.core.redis import REDIS_EXCEPTIONS

            keys: list[str] = []
            async for k in client.scan_iter(match="rl:*", count=100):
                keys.append(k)
                if len(keys) >= 100:
                    await client.delete(*keys)
                    keys.clear()
            if keys:
                await client.delete(*keys)
        except REDIS_EXCEPTIONS as exc:
            logger.warning("redis_rate_limit_clear_failed error=%s", exc)

    def _size(self, key: str) -> int:
        return self._fallback._size(key)


def _choose_limiter() -> RateLimiter:
    try:
        from app.core.config import get_settings

        s = get_settings()
        if s.redis_enabled and s.redis_url:
            return RedisRateLimiter()
    except Exception as exc:
        logger.warning("rate_limit_chooser_failed error=%s", exc)
    return InMemoryRateLimiter()


# global singleton for tests to reset — auto-chooses based on settings
try:
    _global_limiter = _choose_limiter()
except (OSError, RuntimeError) as exc:
    logger.warning("global_limiter_init_failed error=%s", exc)
    _global_limiter = InMemoryRateLimiter()
# public alias
global_rate_limiter = _global_limiter


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Global per-bucket rate limiter (60 req/min by default)."""

    def __init__(self, app, limiter: RateLimiter | None = None):
        super().__init__(app)
        self.limiter: RateLimiter = limiter or _global_limiter

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # allow disabling via settings (useful for tests that want to bypass)
        if not getattr(settings, "rate_limit_enabled", True):
            return await call_next(request)

        # BaseHTTPMiddleware does not support WebSocket upgrades — the
        # middleware tries to buffer the request body, which collides with
        # the WS handshake. Skip the limiter for /ws routes so they reach
        # the route handler untouched.
        if request.url.path.endswith("/ws"):
            return await call_next(request)

        # optionally exempt health / docs / static to avoid noisy 429
        # but spec says enforce globally — keep exempt list minimal (health only for monitoring)
        # we keep health exempt so monitoring doesn't trigger quota
        exempt_paths = {"/health", "/docs", "/openapi.json", "/redoc"}
        if request.url.path in exempt_paths or request.url.path.startswith("/static"):
            return await call_next(request)

        bucket = self._bucket_key(request)
        limit = getattr(settings, "rate_limit_per_minute", 60)
        # support both sync (InMemory) and async (Redis) limiters
        if hasattr(self.limiter, "async_allow"):
            allowed, retry_after = await self.limiter.async_allow(bucket, limit, window_s=60)  # type: ignore
        else:
            allowed, retry_after = self.limiter.allow(bucket, limit, window_s=60)
        if not allowed:
            payload = {
                "error": {
                    "code": "rate_limited",
                    "message": f"Rate limit exceeded. Try again in {retry_after} seconds.",
                    "retry_after": retry_after,
                }
            }
            return JSONResponse(status_code=429, content=payload, headers={"Retry-After": str(retry_after)})
        response = await call_next(request)
        # expose rate limit headers (optional)
        response.headers["X-RateLimit-Limit"] = str(limit)
        return response

    @staticmethod
    def _bucket_key(request: Request) -> str:
        auth = request.headers.get("authorization", "")
        if auth:
            # use first 80 chars of auth header as bucket to isolate per-key
            # hash not needed for in-memory bucket key
            return f"auth:{auth[:80]}"
        # fallback to client IP
        client_host = request.client.host if request.client else "anonymous"
        # Only trust X-Forwarded-For if immediate peer is in trusted_proxies
        trusted_proxies = {ip.strip() for ip in settings.trusted_proxies.split(",") if ip.strip()}
        if client_host in trusted_proxies:
            forwarded = request.headers.get("x-forwarded-for")
            if forwarded:
                candidate = forwarded.split(",")[0].strip()
                if candidate:
                    client_host = candidate
        return f"ip:{client_host}"
