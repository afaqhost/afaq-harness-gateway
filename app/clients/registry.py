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
    from datetime import datetime

    for adapter in all_adapters():
        if adapter.is_installed():
            try:
                MODEL_CACHE[adapter.name] = await adapter.list_models()
            except (OSError, asyncio.TimeoutError):
                MODEL_CACHE[adapter.name] = []
        else:
            MODEL_CACHE[adapter.name] = []
    # persist Harness.last_checked_at and installed to DB (best-effort)
    try:
        from app.db.database import Harness, SessionLocal

        async with SessionLocal() as session:
            from sqlalchemy import select

            for adapter in all_adapters():
                installed = adapter.is_installed()
                row = (await session.execute(select(Harness).where(Harness.name == adapter.name))).scalar_one_or_none()
                if not row:
                    row = Harness(name=adapter.name, display_name=adapter.display_name, executable=adapter.executable, provider=adapter.provider or "", installed=installed, last_checked_at=datetime.utcnow())
                    session.add(row)
                else:
                    row.installed = installed
                    row.last_checked_at = datetime.utcnow()
                    row.display_name = adapter.display_name
            await session.commit()
    except Exception:
        # lifespan may run before DB ready or during tests with in-memory DB (different engine)
        pass


def cached_models(adapter_name: str) -> list[HarnessModel]:
    return MODEL_CACHE.get(adapter_name, [])


def get_adapter(name: str) -> HarnessAdapter:
    if name not in ADAPTERS:
        raise KeyError(f"Unknown harness: {name}")
    return ADAPTERS[name]


def all_adapters() -> list[HarnessAdapter]:
    return list(ADAPTERS.values())
