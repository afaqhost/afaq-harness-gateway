"""Streaming helpers — heartbeat and lifecycle envelope.

Thin transport layer over `HarnessAdapter.stream` that adds
heartbeat (`: keepalive`), `Last-Event-ID` replay, and `cancel` handling.
Controllers delegate here instead of duplicating the 40-line `while True` loop
in both `app/api/chat.py:393` and `app/api/openai.py:198`.
"""

from __future__ import annotations

import asyncio
import time

from app.core.config import settings
from app.shared.sse import sse_event


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
        except Exception:
            pass
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
    except Exception:
        raise
