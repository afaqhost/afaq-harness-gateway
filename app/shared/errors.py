"""Unified error codes and payloads."""

from __future__ import annotations

from enum import StrEnum


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
