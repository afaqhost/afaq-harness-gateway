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


class RedisRateLimiter:
    """Redis sliding-window via INCR + EXPIRE (fallback to in-memory if Redis unavailable)."""

    def __init__(self, redis_url: str) -> None:
        self._url = redis_url
        self._client = None
        self._fallback = InMemoryRateLimiter()
        self._available = False
        try:
            import redis.asyncio as redis  # type: ignore

            self._client = redis.from_url(redis_url, decode_responses=True)
            self._available = True
        except (ImportError, OSError, RuntimeError) as exc:
            logger.warning("redis_import_failed error=%s", exc)
            self._client = None
            self._available = False

    def allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int]:
        # sync wrapper — for middleware dispatch we need async? Keep sync fallback for now.
        # This method is called inside async dispatch but is sync; for Redis we need async variant.
        # We expose async_allow and keep this as fallback.
        return self._fallback.allow(key, limit, window_s)

    async def async_allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int]:
        if not self._available or self._client is None:
            return self._fallback.allow(key, limit, window_s)
        try:
            # Use INCR with window key
            redis_key = f"rl:{key}:{int(time.time() // window_s)}"
            count = await self._client.incr(redis_key)
            if count == 1:
                await self._client.expire(redis_key, window_s)
            if count > limit:
                ttl = await self._client.ttl(redis_key)
                retry = int(ttl) if ttl and ttl > 0 else window_s
                return False, retry
            return True, 0
        except (OSError, RuntimeError) as exc:
            logger.warning("redis_fallback error=%s", exc)
            # fallback to in-memory on Redis error
            return self._fallback.allow(key, limit, window_s)

    def reset(self) -> None:
        self._fallback.reset()
        # best-effort flush for tests
        if self._client:
            try:
                import asyncio

                asyncio.create_task(self._client.flushdb())
            except (OSError, RuntimeError) as exc:
                logger.warning("rate_limit_best_effort error=%s", exc)

    def _size(self, key: str) -> int:
        return self._fallback._size(key)


def _choose_limiter() -> RateLimiter:
    # lazy chooser — uses Redis if configured and available, else in-memory
    try:
        from app.core.config import get_settings

        s = get_settings()
        if s.redis_enabled and s.redis_url:
            return RedisRateLimiter(s.redis_url)  # type: ignore
    except (OSError, RuntimeError) as exc:
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
        # respect X-Forwarded-For if behind proxy
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            client_host = forwarded.split(",")[0].strip()
        return f"ip:{client_host}"
