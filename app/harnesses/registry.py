"""Backwards-compatible facade for adapters and model refresh.

New code should import adapters from ``app.clients.*`` and refresh orchestration
from ``app.services.model_refresh_service`` directly.
This module is kept so existing ``from app.harnesses.registry import ...``
imports keep working without a flag day.
"""

from app.clients.agy import AgyAdapter
from app.clients.base import HarnessAdapter
from app.clients.claude import ClaudeAdapter
from app.clients.codex import CodexAdapter
from app.clients.commandcode import CommandCodeAdapter
from app.clients.generic import GenericAdapter
from app.clients.opencode import OpenCodeAdapter
from app.clients.pi import PiAdapter
from app.clients.registry import (
    ADAPTERS,
    MODEL_CACHE,
    all_adapters,
    cached_models,
    cached_models_clear,
    clear_model_cache_mirror,
    get_adapter,
)
from app.models.harness import HarnessModel, HarnessResult
from app.services.model_refresh_service import refresh_models

__all__ = [
    "HarnessAdapter",
    "HarnessModel",
    "HarnessResult",
    "ClaudeAdapter",
    "CodexAdapter",
    "OpenCodeAdapter",
    "CommandCodeAdapter",
    "AgyAdapter",
    "PiAdapter",
    "GenericAdapter",
    "ADAPTERS",
    "MODEL_CACHE",
    "refresh_models",
    "cached_models",
    "cached_models_clear",
    "clear_model_cache_mirror",
    "get_adapter",
    "all_adapters",
]
