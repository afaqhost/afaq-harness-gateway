"""Shared Redis infrastructure using redis.asyncio.

Provides a reusable async Redis connection pool and client with bounded
connect/socket timeouts, lazy initialization, loop-safe pooling, and an
awaited closure during application shutdown.
"""

from __future__ import annotations

import asyncio
import logging

from redis.exceptions import ConnectionError, RedisError, TimeoutError as RedisTimeoutError

from app.core.config import get_settings

logger = logging.getLogger("afaq")

REDIS_EXCEPTIONS = (RedisError, RedisTimeoutError, ConnectionError, asyncio.TimeoutError, TimeoutError, OSError)


class RedisProvider:
    """Manages a shared redis.asyncio connection pool and client."""

    def __init__(self) -> None:
        self._pool = None
        self._client = None
        self._custom_client = None

    def set_client(self, client) -> None:
        """Inject a custom or fake async client (primarily for testing)."""
        self._custom_client = client

    def clear_custom_client(self) -> None:
        """Clear injected test client."""
        self._custom_client = None

    def _assert_no_live_pool_or_client(self) -> None:
        """Assert no active unclosed pool or client remains in test teardown."""
        assert self._client is None and self._pool is None and self._custom_client is None, (
            "Live Redis client or pool still active. Must await close_redis() before test exit."
        )

    def _reset_local_testing(self) -> None:
        """Private test-only reset. Asserts no live pool or client is discarded without closing."""
        self._assert_no_live_pool_or_client()

    async def get_client(self):
        """Lazily return a shared redis.asyncio.Redis client or None if Redis disabled/unavailable."""
        if self._custom_client is not None:
            return self._custom_client

        s = get_settings()
        if not s.redis_enabled or not s.redis_url:
            return None

        if self._client is not None:
            return self._client

        try:
            import redis.asyncio as aioredis

            connect_timeout = getattr(s, "redis_connect_timeout_seconds", 2.0)
            socket_timeout = getattr(s, "redis_socket_timeout_seconds", 2.0)

            self._pool = aioredis.ConnectionPool.from_url(
                s.redis_url,
                socket_connect_timeout=connect_timeout,
                socket_timeout=socket_timeout,
                decode_responses=True,
            )
            self._client = aioredis.Redis(connection_pool=self._pool)
            return self._client
        except REDIS_EXCEPTIONS as exc:
            logger.warning("redis_init_failed error=%s", exc)
            self._client = None
            self._pool = None
            return None

    async def aclose(self) -> None:
        """Gracefully close and cleanup the shared Redis client and pool."""
        client = self._client
        pool = self._pool
        custom_client = self._custom_client
        self._client = None
        self._pool = None
        self._custom_client = None

        if custom_client is not None and hasattr(custom_client, "aclose"):
            try:
                await custom_client.aclose()
            except REDIS_EXCEPTIONS as exc:
                logger.warning("redis_custom_client_close_error error=%s", exc)

        if client is not None:
            try:
                await client.aclose()
            except REDIS_EXCEPTIONS as exc:
                logger.warning("redis_client_close_error error=%s", exc)

        if pool is not None and hasattr(pool, "aclose"):
            try:
                await pool.aclose()
            except REDIS_EXCEPTIONS as exc:
                logger.warning("redis_pool_close_error error=%s", exc)


_redis_provider = RedisProvider()


def get_redis_provider() -> RedisProvider:
    """Return the global RedisProvider singleton."""
    return _redis_provider


async def get_redis_client():
    """Convenience helper to retrieve the shared async Redis client."""
    return await _redis_provider.get_client()


async def close_redis() -> None:
    """Convenience helper to close the shared Redis client during shutdown."""
    await _redis_provider.aclose()
