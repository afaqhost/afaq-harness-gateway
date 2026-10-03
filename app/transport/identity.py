"""Stream identity validation and history-key construction.

Shared helper for streaming endpoints to prevent collision between streams,
isolate history keys by resource/user/stream, and enforce safe stream IDs.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Literal, Protocol

from fastapi import HTTPException

STREAM_ID_PATTERN = r"^[A-Za-z0-9_\-]{1,128}$"
STREAM_ID_REGEX = re.compile(STREAM_ID_PATTERN)


class StreamHistoryLookup(Protocol):
    def has_history(self, key: str) -> bool:
        ...


@dataclass(frozen=True)
class StreamIdentity:
    stream_id: str
    history_key: str
    last_event_id: int | None
    is_reconnect: bool


def generate_stream_id() -> str:
    """Generate an opaque server stream ID."""
    return uuid.uuid4().hex


def validate_stream_id(stream_id: str) -> str:
    """Validate caller-provided stream ID using conservative bounded format.

    Rejects invalid values with HTTP 400 so arbitrary Redis key material
    cannot be injected.
    """
    if not STREAM_ID_REGEX.match(stream_id):
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "invalid_stream_id", "message": "Invalid X-Stream-ID format. Must be 1-128 URL-safe ASCII characters (alphanumeric, dash, underscore)."}},
        )
    return stream_id


def validate_last_event_id(last_event_id: str | None) -> int | None:
    """Validate Last-Event-ID header as non-negative integer."""
    if last_event_id is None:
        return None
    try:
        val = int(last_event_id)
        if val < 0:
            raise ValueError
        return val
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "invalid_last_event_id", "message": "Invalid Last-Event-ID header. Must be a non-negative integer."}},
        )


def build_history_key(
    endpoint: Literal["openai", "conv"],
    user_id: int | str,
    stream_id: str,
    resource_id: int | str | None = None,
) -> str:
    """Construct an isolated history key scoped by endpoint, user, resource, and stream ID.

    OpenAI: openai:{user_id}:{stream_id}
    Conversation: conv:{user_id}:{resource_id}:{stream_id}
    """
    if endpoint == "openai":
        return f"openai:{user_id}:{stream_id}"
    elif endpoint == "conv":
        if resource_id is None:
            raise ValueError("resource_id (conversation id) required for conversation streams")
        return f"conv:{user_id}:{resource_id}:{stream_id}"
    else:
        raise ValueError(f"Unknown endpoint: {endpoint}")


def resolve_stream_identity(
    endpoint: Literal["openai", "conv"],
    user_id: int | str,
    stream_id: str | None,
    last_event_id: str | None,
    history: StreamHistoryLookup | None = None,
    resource_id: int | str | None = None,
) -> StreamIdentity:
    """Validate stream headers, resolve stream identity, and construct scoped history key.

    Enforces:
    1. Last-Event-ID requires matching X-Stream-ID (HTTP 400)
    2. Caller-provided stream IDs match conservative format (HTTP 400)
    3. Reusing an existing stream ID without Last-Event-ID is rejected (HTTP 409)
    4. Reconnect to an unknown/expired stream ID is rejected (HTTP 404)
    5. Opaque stream ID is generated if omitted
    """
    if history is None:
        from app.services.process_registry import process_registry

        history = process_registry

    parsed_last_id = validate_last_event_id(last_event_id)

    # Requirement 4: Last-Event-ID must have matching X-Stream-ID
    if parsed_last_id is not None and not stream_id:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "missing_stream_id", "message": "Last-Event-ID requires X-Stream-ID header."}},
        )

    if stream_id is not None:
        sid = validate_stream_id(stream_id)
        key = build_history_key(endpoint, user_id, sid, resource_id=resource_id)
        exists = bool(history.has_history(key))

        # Requirement 7: Reject reuse of existing stream ID without Last-Event-ID
        if exists and parsed_last_id is None:
            raise HTTPException(
                status_code=409,
                detail={"error": {"code": "stream_id_conflict", "message": "Stream ID already exists. Specify Last-Event-ID to reconnect or use a new X-Stream-ID."}},
            )

        # Reconnect to non-existent stream ID
        if parsed_last_id is not None and not exists:
            raise HTTPException(
                status_code=404,
                detail={"error": {"code": "stream_not_found", "message": "Stream not found or history expired."}},
            )

        return StreamIdentity(
            stream_id=sid,
            history_key=key,
            last_event_id=parsed_last_id,
            is_reconnect=(parsed_last_id is not None),
        )
    else:
        sid = generate_stream_id()
        key = build_history_key(endpoint, user_id, sid, resource_id=resource_id)
        return StreamIdentity(
            stream_id=sid,
            history_key=key,
            last_event_id=None,
            is_reconnect=False,
        )
