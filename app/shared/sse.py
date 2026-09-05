"""SSE helpers — event envelope per spec."""

from __future__ import annotations

import json


def sse_event(event: str, data: dict | str, id: int | None = None, retry: int | None = None) -> str:
    lines: list[str] = []
    if id is not None:
        lines.append(f"id: {id}")
    if event:
        lines.append(f"event: {event}")
    if retry is not None:
        lines.append(f"retry: {retry}")
    payload = json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else str(data)
    # split payload into multiple data: lines per SSE spec
    for chunk in payload.splitlines() or [""]:
        lines.append(f"data: {chunk}")
    lines.append("")
    lines.append("")
    return "\n".join(lines)


def sse_keepalive() -> str:
    return ": keepalive\n\n"


def sse_done() -> str:
    # S4 spec: event: done with [DONE]
    return sse_event("done", "[DONE]")


def sse_error(data: dict, id: int | None = None) -> str:
    return sse_event("error", data, id=id, retry=3000)


def sse_token(chunk: dict, id: int, retry: int = 3000) -> str:
    return sse_event("token", chunk, id=id, retry=retry)
