"""Composition root for harness adapters — wiring of concrete clients.

This is the single place where concretes are bound to the registry.
Services depend on the abstract ``HarnessAdapter`` via this registry,
never on a concrete CLI class directly (DIP).
"""

from __future__ import annotations

import asyncio

from app.clients.base import HarnessAdapter
from app.clients.claude import ClaudeAdapter
from app.clients.codex import CodexAdapter
from app.clients.commandcode import CommandCodeAdapter
from app.clients.opencode import OpenCodeAdapter
from app.models.harness import HarnessModel

ADAPTERS: dict[str, HarnessAdapter] = {
    "claude": ClaudeAdapter(),
    "codex": CodexAdapter(),
    "opencode": OpenCodeAdapter(),
    "commandcode": CommandCodeAdapter(),
}

MODEL_CACHE: dict[str, list[HarnessModel]] = {}


async def refresh_models() -> None:
    for adapter in all_adapters():
        if adapter.is_installed():
            try:
                MODEL_CACHE[adapter.name] = await adapter.list_models()
            except (OSError, asyncio.TimeoutError):
                MODEL_CACHE[adapter.name] = []
        else:
            MODEL_CACHE[adapter.name] = []


def cached_models(adapter_name: str) -> list[HarnessModel]:
    return MODEL_CACHE.get(adapter_name, [])


def get_adapter(name: str) -> HarnessAdapter:
    if name not in ADAPTERS:
        raise KeyError(f"Unknown harness: {name}")
    return ADAPTERS[name]


def all_adapters() -> list[HarnessAdapter]:
    return list(ADAPTERS.values())
