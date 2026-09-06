"""Structured output validation for response_format."""

from __future__ import annotations

import json
from typing import Any


def validate_json_response(text: str, fmt) -> dict | Any | None:
    """Validate text against ResponseFormat.

    Returns parsed object on success, None on failure.
    fmt is expected to have .type and .json_schema attributes (pydantic model or dict).
    """
    if fmt is None:
        return None
    # support both pydantic model and dict
    fmt_type = getattr(fmt, "type", None) or (fmt.get("type") if isinstance(fmt, dict) else None)
    if fmt_type == "json_object":
        try:
            return json.loads(text)
        except (json.JSONDecodeError, TypeError):
            return None
    if fmt_type == "json_schema":
        try:
            data = json.loads(text)
        except (json.JSONDecodeError, TypeError):
            return None
        # try jsonschema validation if available
        schema = getattr(fmt, "json_schema", None)
        if schema is None and isinstance(fmt, dict):
            schema = fmt.get("json_schema")
        # schema may be {"name":..., "schema": {...}} or raw schema
        target_schema = None
        if isinstance(schema, dict):
            # if schema contains "schema" key, use it
            if "schema" in schema and isinstance(schema["schema"], dict):
                target_schema = schema["schema"]
            else:
                target_schema = schema
        if target_schema is not None:
            try:
                import jsonschema

                jsonschema.validate(data, target_schema)
            except ImportError:
                # if jsonschema not installed, just return data (or raise)
                pass
            except (ValueError, TypeError, KeyError) as exc:
                import logging; logging.getLogger("afaq").warning("jsonschema_validation_failed error=%s", exc)
                return None
        return data
    return None
