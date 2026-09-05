"""Backwards-compatible facade — delegates to the proper Client layer.

New code should import from ``app.clients.*`` directly.
This module is kept so existing ``from app.harnesses.registry import ...``
imports keep working without a flag day.
"""

from app.clients.base import HarnessAdapter
from app.clients.claude import ClaudeAdapter
from app.clients.codex import CodexAdapter
from app.clients.commandcode import CommandCodeAdapter
from app.clients.generic import GenericAdapter
from app.clients.opencode import OpenCodeAdapter
from app.clients.registry import (
    ADAPTERS,
    MODEL_CACHE,
    all_adapters,
    cached_models,
    get_adapter,
    refresh_models,
)
from app.models.harness import HarnessModel, HarnessResult

__all__ = [
    "HarnessAdapter",
    "HarnessModel",
    "HarnessResult",
    "ClaudeAdapter",
    "CodexAdapter",
    "OpenCodeAdapter",
    "CommandCodeAdapter",
    "GenericAdapter",
    "ADAPTERS",
    "MODEL_CACHE",
    "refresh_models",
    "cached_models",
    "get_adapter",
    "all_adapters",
]
