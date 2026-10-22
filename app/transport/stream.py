"""Streaming helpers — heartbeat, disconnect, and SSE lifecycle envelope.

Thin transport layer over `HarnessAdapter.stream` that adds
heartbeat (`: keepalive`), `Last-Event-ID` replay, and `cancel` handling.
Controllers delegate here instead of duplicating the ~40-line `while True` loop
with `asyncio.wait` and disconnect checks.
"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from app.core.config import settings
from app.shared.sse import sse_event

logger = logging.getLogger("afaq")


class StreamItem:
    """Item yielded by pump_harness_stream."""

    __slots__ = ("is_keepalive", "is_cancelled", "text", "metadata")

    def __init__(
        self,
        is_keepalive: bool = False,
        is_cancelled: bool = False,
        text: str = "",
        metadata: dict | None = None,
    ):
        self.is_keepalive = is_keepalive
        self.is_cancelled = is_cancelled
        self.text = text
        self.metadata = metadata or {}


from app.core.redis import REDIS_EXCEPTIONS


async def replay_sse_events(history_key: str, last_event_id: str | None) -> tuple[list[str], int]:
    """Return (replayed_chunks, next_seq) from history for Last-Event-ID."""
    if last_event_id is None:
        return [], 1
    try:
        last_id = int(last_event_id)
    except ValueError:
        return [], 1
    from app.services.process_registry import process_registry

    replayed = await process_registry.get_replay(history_key, last_id)
    hist = await process_registry.get_history(history_key)
    seq = max(s for s, _ in hist) + 1 if hist else last_id + 1
    return list(replayed), seq


async def store_and_format_sse(
    history_key: str,
    event: str,
    data,
    seq: int,
    retry_ms: int | None = None,
) -> str:
    """Format SSE payload and store in history for replay."""
    from app.services.process_registry import process_registry

    if retry_ms is None:
        retry_ms = settings.sse_retry_ms
    payload = sse_event(event, data, id=seq, retry=retry_ms)
    try:
        await process_registry.append_history(history_key, seq, payload)
    except REDIS_EXCEPTIONS as exc:
        logger.warning("history_append_failed error=%s", exc)
    return payload


async def pump_harness_stream(
    stream_iter,
    request,
    request_id: str,
    heartbeat_seconds: float | None = None,
) -> AsyncIterator[StreamItem]:
    """Pump stream items from adapter with keepalive heartbeats and disconnect cancellation."""
    from app.services.process_registry import process_registry

    interval = heartbeat_seconds if heartbeat_seconds is not None else settings.sse_heartbeat_seconds
    pending = None
    try:
        while True:
            if await request.is_disconnected():
                logger.info("client_disconnected cancelling request_id=%s", request_id)
                await process_registry.cancel(request_id)
                if pending:
                    pending.cancel()
                yield StreamItem(is_cancelled=True)
                break
            if pending is None:
                pending = asyncio.create_task(stream_iter.__anext__())
            done, _ = await asyncio.wait([pending], timeout=interval)
            if not done:
                yield StreamItem(is_keepalive=True)
                continue
            try:
                text, metadata = pending.result()
            except StopAsyncIteration:
                break
            pending = None

            if await request.is_disconnected():
                logger.info("client_disconnected cancelling request_id=%s", request_id)
                await process_registry.cancel(request_id)
                yield StreamItem(is_cancelled=True)
                break

            yield StreamItem(text=text, metadata=metadata)
    finally:
        if pending and not pending.done():
            pending.cancel()
            try:
                await pending
            except (asyncio.CancelledError, Exception):
                pass
