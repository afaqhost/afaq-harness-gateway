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
from app.shared.time import utcnow

ADAPTERS: dict[str, HarnessAdapter] = {
    "claude": ClaudeAdapter(),
    "codex": CodexAdapter(),
    "opencode": OpenCodeAdapter(),
    "commandcode": CommandCodeAdapter(),
}

MODEL_CACHE: dict[str, list[HarnessModel]] = {}

# Redis-backed cache for multi-replica deployments — fallback to in-memory
_REDIS_TTL = 300  # seconds, matches model_refresh_seconds


def _get_redis():
    try:
        from app.core.config import get_settings

        s = get_settings()
        if not s.redis_enabled or not s.redis_url:
            return None
        import redis as sync_redis  # type: ignore

        client = sync_redis.from_url(s.redis_url, decode_responses=True)
        client.ping()
        return client
    except (ImportError, OSError, RuntimeError) as exc:
        import logging; logging.getLogger("afaq").warning("redis_unavailable error=%s", exc)
        return None


def _redis_key(adapter_name: str) -> str:
    return f"models:{adapter_name}"


def _harness_models_to_dicts(models: list[HarnessModel]) -> list[dict]:
    return [m.__dict__ for m in models]


def _dicts_to_harness_models(dicts: list[dict]) -> list[HarnessModel]:
    # tolerant reconstruction
    result: list[HarnessModel] = []
    for d in dicts:
        try:
            result.append(HarnessModel(**{k: v for k, v in d.items() if k in HarnessModel.__dataclass_fields__}))
        except (TypeError, ValueError, KeyError) as exc:
            import logging; logging.getLogger("afaq").warning("model_reconstruct_failed error=%s", exc)
            # fallback minimal
            try:
                result.append(HarnessModel(id=str(d.get("id", "")), harness=str(d.get("harness", "")), provider=d.get("provider"), name=str(d.get("name", ""))))
            except (TypeError, ValueError, KeyError) as exc:
                import logging; logging.getLogger("afaq").warning("model_skip_failed error=%s", exc)
                continue
    return result


async def refresh_models() -> None:
    from datetime import datetime
    import json

    redis_client = _get_redis()

    for adapter in all_adapters():
        if adapter.is_installed():
            try:
                models = await adapter.list_models()
                MODEL_CACHE[adapter.name] = models
                # also write to Redis if available
                if redis_client:
                    try:
                        redis_client.set(_redis_key(adapter.name), json.dumps(_harness_models_to_dicts(models)), ex=_REDIS_TTL)
                    except (OSError, RuntimeError) as exc:
                        import logging; logging.getLogger("afaq").warning("redis_cache_best_effort error=%s", exc)
            except (OSError, asyncio.TimeoutError, RuntimeError) as exc:
                MODEL_CACHE[adapter.name] = []
                if redis_client:
                    try:
                        redis_client.delete(_redis_key(adapter.name))
                    except (OSError, RuntimeError) as exc:
                        import logging; logging.getLogger("afaq").warning("redis_cache_best_effort error=%s", exc)
        else:
            MODEL_CACHE[adapter.name] = []
            if redis_client:
                try:
                    redis_client.delete(_redis_key(adapter.name))
                except (OSError, RuntimeError) as exc:
                    import logging

                    logging.getLogger("afaq").warning("redis_delete_failed error=%s", exc)
    # persist Harness.last_checked_at and installed to DB (best-effort)
    try:
        from app.db.database import Harness, SessionLocal

        async with SessionLocal() as session:
            from sqlalchemy import select

            for adapter in all_adapters():
                installed = adapter.is_installed()
                row = (await session.execute(select(Harness).where(Harness.name == adapter.name))).scalar_one_or_none()
                if not row:
                    row = Harness(name=adapter.name, display_name=adapter.display_name, executable=adapter.executable, provider=adapter.provider or "", installed=installed, last_checked_at=utcnow())
                    session.add(row)
                else:
                    row.installed = installed
                    row.last_checked_at = utcnow()
                    row.display_name = adapter.display_name
            await session.commit()
    except (OSError, RuntimeError) as exc:
        import logging; logging.getLogger("afaq").warning("refresh_persist_failed error=%s", exc)
        # lifespan may run before DB ready or during tests with in-memory DB (different engine)
        pass


def cached_models(adapter_name: str) -> list[HarnessModel]:
    # try Redis first for cross-replica consistency, fallback to in-memory
    try:
        redis_client = _get_redis()
        if redis_client:
            import json

            raw = redis_client.get(_redis_key(adapter_name))
            if raw:
                dicts = json.loads(raw)
                if isinstance(dicts, list):
                    return _dicts_to_harness_models(dicts)
    except (OSError, RuntimeError) as exc:
        import logging; logging.getLogger("afaq").warning("cache_fallback error=%s", exc)
        pass
    return MODEL_CACHE.get(adapter_name, [])


def get_adapter(name: str) -> HarnessAdapter:
    if name not in ADAPTERS:
        raise KeyError(f"Unknown harness: {name}")
    return ADAPTERS[name]


def all_adapters() -> list[HarnessAdapter]:
    return list(ADAPTERS.values())