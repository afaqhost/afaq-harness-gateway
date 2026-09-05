"""Leaf helpers for building harness prompts — pure string transforms."""

from __future__ import annotations


def build_history_prompt(roles_and_contents: list[tuple[str, str]]) -> str:
    """Join ``(role, content)`` pairs into ``\"role: content\"`` lines."""
    return "\n".join(f"{role}: {content}" for role, content in roles_and_contents)


def build_harness_prompt(system_prompt: str | None, history_prompt: str) -> str:
    """Prepend SYSTEM block if a system prompt is present."""
    if system_prompt:
        return f"SYSTEM: {system_prompt}\n\n{history_prompt}"
    return history_prompt


def extract_system_prompt(messages: list[dict], default: str | None) -> tuple[str | None, list[dict]]:
    """Split system messages from a list of ``{role, content}`` dicts.

    Returns ``(system_prompt, other_messages)``. If no system message is
    present, *default* is used.
    """
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    other = [m for m in messages if m.get("role") != "system"]
    system_prompt = "\n".join(system_parts) if system_parts else default
    return system_prompt, other
