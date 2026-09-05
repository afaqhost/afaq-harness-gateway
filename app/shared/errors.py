"""Unified error codes and payloads."""

from __future__ import annotations

from enum import StrEnum


def sanitize_harness_error(exc: Exception) -> str:
    """Map raw harness exception text to a user-safe message.

    Centralized owner for harness error sanitization so controllers and
    services do not duplicate the same branching knowledge (DRY) and
    so error mapping lives at one explicit boundary (SRP).
    """
    message = str(exc).lower()
    if "ollama" in message or ("model" in message and "not found" in message):
        return "Harness failed — check model availability"
    if "timed out" in message or "timeout" in message:
        return "Harness timed out — try again or use a different model"
    return "Harness error — please try again later"


class ErrorCode(StrEnum):
    validation_error = "validation_error"
    auth_error = "auth_error"
    harness_error = "harness_error"
    rate_limited = "rate_limited"
    model_forbidden = "model_forbidden"
    quota_exceeded = "quota_exceeded"
    not_found = "not_found"
    malformed_output = "malformed_output"
    conflict = "conflict"
    no_recipe = "no_recipe"


def error_payload(code: ErrorCode | str, message: str, retryable: bool = False, **extra) -> dict:
    payload = {"error": {"code": str(code), "message": message, "type": str(code), "retryable": retryable}}
    if extra:
        payload["error"].update(extra)
    return payload
