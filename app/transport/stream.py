"""Streaming helpers — heartbeat, disconnect, and SSE lifecycle envelope.

Thin transport layer over `HarnessAdapter.stream` that adds
heartbeat (`: keepalive`), `Last-Event-ID` replay, and `cancel` handling.
Controllers delegate here instead of duplicating the ~40-line `while True` loop
with `asyncio.wait` and disconnect checks.
"""

from __future__ import annotations

import asyncio
import logging
import time
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


def replay_sse_events(history_key: str, last_event_id: str | None) -> tuple[list[str], int]:
    """Return (replayed_chunks, next_seq) from history for Last-Event-ID."""
    if last_event_id is None:
        return [], 1
    try:
        last_id = int(last_event_id)
    except ValueError:
        return [], 1
    from app.services.process_registry import process_registry

    replayed = list(process_registry.get_replay(history_key, last_id))
    hist = process_registry.get_history(history_key)
    seq = max(s for s, _ in hist) + 1 if hist else last_id + 1
    return replayed, seq


def store_and_format_sse(
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
        process_registry.append_history(history_key, seq, payload)
    except (OSError, RuntimeError) as exc:
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


def _next_seq(history) -> int:
    if not history:
        return 1
    return max(s for s, _ in history) + 1


async def heartbeat_stream(
    adapter,
    prompt: str,
    model: str,
    request_id: str,
    env: dict | None,
    history_store,
    history_key: str,
    last_event_id: str | None,
    request,  # Starlette Request with is_disconnected
    start_payload: dict,
    heartbeat_s: int | None = None,
):
    """Yield SSE payloads for a harness stream with heartbeat/replay.

    This is the single owner for the streaming loop previously duplicated
    in two controllers. Behavior preserved: heartbeat via `asyncio.wait`
    timeout, `cancel` on `is_disconnected`, `replay` via `HistoryStore`.
    """
    from app.services.process_registry import process_registry

    heartbeat_interval = heartbeat_s if heartbeat_s is not None else settings.sse_heartbeat_seconds
    seq = 1

    def _store(event: str, data, id_val: int | None = None, retry: int | None = None) -> str:
        if retry is None:
            retry = settings.sse_retry_ms
        payload = sse_event(event, data, id=id_val, retry=retry)
        try:
            history_store.append(history_key, id_val if id_val is not None else seq, payload)
        except (OSError, RuntimeError, AttributeError) as exc:
            import logging; logging.getLogger("afaq").warning("history_append_failed error=%s", exc)
        return payload

    # replay
    if last_event_id is not None:
        try:
            last_id = int(last_event_id)
            for rp in history_store.replay(history_key, last_id):
                yield rp
            hist = history_store.get_history(history_key)
            seq = _next_seq(hist) if hist else last_id + 1
        except ValueError:
            pass

    yield _store("start", start_payload, id_val=seq, retry=settings.sse_retry_ms)
    seq += 1

    stream_iter = adapter.stream(prompt, model, request_id=request_id, env=env).__aiter__()
    pending = None
    collected: list[str] = []
    cancelled = False
    started = time.monotonic()

    try:
        while True:
            if await request.is_disconnected():
                await process_registry.cancel(request_id)
                cancelled = True
                if pending:
                    pending.cancel()
                yield _store("cancel", {"code": "cancelled", "message": "cancelled by client"}, id_val=seq)
                break
            if pending is None:
                pending = asyncio.create_task(stream_iter.__anext__())
            done, _ = await asyncio.wait([pending], timeout=heartbeat_interval)
            if not done:
                yield ": keepalive\n\n"
                continue
            try:
                text, metadata = pending.result()
            except StopAsyncIteration:
                break
            pending = None

            if await request.is_disconnected():
                await process_registry.cancel(request_id)
                cancelled = True
                yield _store("cancel", {"code": "cancelled", "message": "cancelled by client"}, id_val=seq)
                break

            # tool_call passthrough (kept for OpenAI path; chat path ignores)
            if "tool_call" in metadata:
                # handled by caller — yield as token passthrough
                yield text, metadata  # type: ignore
                continue

            if not text:
                continue
            collected.append(text)
            chunk = {
                "id": request_id,
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model,
                "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
            }
            yield _store("token", chunk, id_val=seq, retry=settings.sse_retry_ms)
            seq += 1

        if cancelled:
            return
        if not collected:
            raise RuntimeError("Harness returned empty response")
        # usage/done are emitted by caller to keep metrics/DB ownership in service layer
        # this helper yields only token/start/cancel/keepalive
    except (OSError, RuntimeError, asyncio.TimeoutError) as exc:
        import logging; logging.getLogger("afaq").warning("stream_helper_failed error=%s", exc)
        raise
