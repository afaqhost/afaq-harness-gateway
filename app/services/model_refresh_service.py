"""Refresh discovered models and persist adapter installation state in a short transaction."""

import asyncio
import logging

from app.clients import registry
from app.clients.base import HarnessAdapter
from app.db import database
from app.db.database import Harness
from app.repositories.harness_repository import sync_harnesses
from app.shared.time import utcnow


async def _sync_adapter_installations(adapters: list[HarnessAdapter]) -> None:
    discovered = [
        Harness(
            name=adapter.name,
            display_name=adapter.display_name,
            executable=adapter.executable,
            provider=adapter.provider or "",
            installed=await asyncio.to_thread(adapter.is_installed),
            last_checked_at=utcnow(),
        )
        for adapter in adapters
    ]
    async with database.SessionLocal() as session:
        await sync_harnesses(session, discovered)
        await session.commit()


async def refresh_models() -> None:
    await registry.refresh_model_cache()
    try:
        await _sync_adapter_installations(registry.all_adapters())
    except (OSError, RuntimeError) as exc:
        logging.getLogger("afaq").warning("refresh_persist_failed error=%s", exc)
