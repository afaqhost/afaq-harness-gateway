"""Leaf utility for harness model identifiers.

Public identifiers are of the form ``harness//model`` (canonical) or
``harness/model`` (legacy). This module owns the parsing rule so the
same knowledge is not duplicated across controllers and services.
"""

from __future__ import annotations


def parse_model_identifier(model: str) -> tuple[str, str]:
    """Split a public model identifier into ``(harness, model)``.

    Preserves the historical ``split('/', 2)`` behaviour exactly:
    - ``harness//provider/model`` -> (harness, provider/model)
    - ``harness/model``          -> (harness, model)
    - ``harness``                -> (harness, "default")
    - ``""`` or falsy            -> ("", "default")
    """
    if not model:
        return "", "default"
    parts = model.split("/", 2)
    if len(parts) == 3:
        return parts[0], parts[2]
    if len(parts) == 2:
        return parts[0], parts[1]
    return parts[0], "default"


# Backwards-compatible alias – existing call sites use ``split_model``.
def split_model(model: str) -> tuple[str, str]:
    return parse_model_identifier(model)


def preview_text(text: str, max_len: int = 80) -> str:
    """Truncate *text* to a single-line preview for titles and lists."""
    single_line = text.strip().replace("\n", " ")
    if len(single_line) <= max_len:
        return single_line
    return single_line[:max_len] + "…"
