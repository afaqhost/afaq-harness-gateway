"""Tool validation service — no execution, just schema handling."""

from __future__ import annotations

from app.shared.structured_output import validate_json_response


def is_valid_tool_calls(text: str, tools) -> bool:
    # placeholder for future execution validation
    return True


__all__ = ["validate_json_response"]
