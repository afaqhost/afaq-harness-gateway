"""Canonical harness data shapes — one source of truth for model + result.

These types are used by clients (adapters), services, and controllers.
They are defined here (models layer) so serialization and persistence
can be derived from a single definition.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class HarnessModel:
    id: str
    harness: str
    provider: str | None
    name: str
    context_window: int | None = None
    pricing: dict = field(default_factory=dict)


@dataclass
class HarnessResult:
    text: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    raw: dict | str | None = None
    finish_reason: str = "stop"
