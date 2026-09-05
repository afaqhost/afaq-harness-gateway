"""Harness concurrency limiter — backpressure for `512 MB` handling.

Limits concurrent `create_subprocess_exec` calls to `harness_concurrency`
(5 by default). Additional requests wait up to `harness_queue_max_wait`
then return `429` instead of OOMing the host with 50 `node` processes.
Works per-replica (asyncio.Semaphore). For multi-replica, `Redis` BLPOP
can be added later — current is sufficient for single-node `512 MB`.

Usage: wrap `adapter.run/stream` bodies with `async with harness_queue.slot():`
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import HTTPException

from app.core.config import settings


class HarnessQueue:
    def __init__(self, max_concurrent: int | None = None, max_wait_s: int | None = None) -> None:
        self._max = max_concurrent if max_concurrent is not None else settings.harness_concurrency
        self._wait = max_wait_s if max_wait_s is not None else settings.harness_queue_max_wait
        self._sem = asyncio.Semaphore(self._max)

    @asynccontextmanager
    async def slot(self):
        # try to acquire within wait window, else 429
        try:
            await asyncio.wait_for(self._sem.acquire(), timeout=self._wait)
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": {
                        "code": "rate_limited",
                        "message": f"Harness busy — {self._max} concurrent runs, try again in {self._wait}s",
                        "retry_after": self._wait,
                    }
                },
                headers={"Retry-After": str(self._wait)},
            )
        try:
            yield
        finally:
            self._sem.release()

    def available(self) -> int:
        # for metrics / tests
        return self._sem._value  # type: ignore

    def queued(self) -> int:
        # approximate: not exposed by Semaphore, return 0
        return 0


# singleton
harness_queue = HarnessQueue()
