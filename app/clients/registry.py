"""Composition root for harness adapters — wiring of concrete clients.

This is the single place where concretes are bound to the registry.
Services depend on the abstract ``HarnessAdapter`` via this registry,
never on a concrete CLI class directly (DIP).
"""

from __future__ import annotations

import asyncio

from app.clients.agy import AgyAdapter
from app.clients.base import HarnessAdapter
from app.clients.claude import ClaudeAdapter
from app.clients.codex import CodexAdapter
from app.clients.commandcode import CommandCodeAdapter
from app.clients.generic import GenericAdapter
from app.clients.opencode import OpenCodeAdapter
from app.clients.pi import PiAdapter
from app.models.harness import HarnessModel
from app.shared.time import utcnow

ADAPTERS: dict[str, HarnessAdapter] = {
    "claude": ClaudeAdapter(),
    "codex": CodexAdapter(),
    "opencode": OpenCodeAdapter(),
    "commandcode": CommandCodeAdapter(),
    "agy": AgyAdapter(),
    "pi": PiAdapter(),
    # Generic bulk — text-only until proven Custom (P02)
    "minimax": GenericAdapter(
        name="minimax",
        executable="minimax",
        provider="minimax",
        display_name="Minimax",
        command_template=["minimax", "--print", "{prompt}", "--model", "{model}"],
        install_command=["npm", "install", "-g", "minimax-cli"],
        update_command=["npm", "update", "-g", "minimax-cli"],
    ),
    "aider": GenericAdapter(
        name="aider",
        executable="aider",
        provider="aider",
        display_name="Aider",
        command_template=["aider", "--message", "{prompt}", "--model", "{model}", "--no-auto-commits", "--no-dirty-commits"],
    ),
    "cline": GenericAdapter(
        name="cline",
        executable="cline",
        provider="cline",
        display_name="Cline",
        command_template=["cline", "--print", "{prompt}", "--model", "{model}"],
        install_command=["npm", "install", "-g", "@cline/cli"],
        update_command=["npm", "update", "-g", "@cline/cli"],
    ),
    "cursor": GenericAdapter(
        name="cursor",
        executable="cursor-agent",
        provider="cursor",
        display_name="Cursor",
        command_template=["cursor-agent", "--print", "{prompt}", "--model", "{model}"],
    ),
    "grok": GenericAdapter(
        name="grok",
        executable="grok",
        provider="grok",
        display_name="Grok",
        command_template=["grok", "--print", "{prompt}", "--model", "{model}"],
        install_command=["npm", "install", "-g", "@xai-official/grok"],
        update_command=["npm", "update", "-g", "@xai-official/grok"],
    ),
    "kimi": GenericAdapter(
        name="kimi",
        executable="kimi",
        provider="kimi",
        display_name="Kimi",
        command_template=["kimi", "-m", "{model}", "--prompt={prompt}", "--output-format", "stream-json"],
        install_command=["npm", "install", "-g", "@moonshot/kimi-code"],
        update_command=["npm", "update", "-g", "@moonshot/kimi-code"],
    ),
    "omp": GenericAdapter(
        name="omp",
        executable="omp",
        provider="omp",
        display_name="OMP",
        command_template=["omp", "--print", "{prompt}", "--model", "{model}"],
    ),
    "qoder": GenericAdapter(
        name="qoder",
        executable="qodercli",
        provider="qoder",
        display_name="Qoder",
        command_template=["qodercli", "--print", "{prompt}", "--model", "{model}"],
    ),
    "vibe": GenericAdapter(
        name="vibe",
        executable="vibe",
        provider="vibe",
        display_name="Vibe",
        command_template=["vibe", "--print", "{prompt}", "--model", "{model}"],
    ),
    "copilot": GenericAdapter(
        name="copilot",
        executable="copilot",
        provider="copilot",
        display_name="Muse",
        command_template=["copilot", "--print", "{prompt}", "--model", "{model}"],
        install_command=["npm", "install", "-g", "@github/copilot"],
        update_command=["npm", "update", "-g", "@github/copilot"],
    ),
    "warp": GenericAdapter(
        name="warp",
        executable="oz",
        provider="warp",
        display_name="Warp",
        command_template=["oz", "--print", "{prompt}", "--model", "{model}"],
    ),
    "zcode": GenericAdapter(
        name="zcode",
        executable="zcode",
        provider="zcode",
        display_name="Zcode",
        command_template=["zcode", "--print", "{prompt}", "--mode", "plan", "--model", "{model}"],
    ),
}

MODEL_CACHE: dict[str, list[HarnessModel]] = {}

# Redis-backed cache for multi-replica deployments — fallback to in-memory
_REDIS_TTL = 300  # seconds, matches model_refresh_seconds


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
    import json
    from app.core.redis import REDIS_EXCEPTIONS, get_redis_client

    try:
        redis_client = await get_redis_client()
    except REDIS_EXCEPTIONS as exc:
        import logging
        logging.getLogger("afaq").warning("redis_unavailable error=%s", exc)
        redis_client = None

    for adapter in all_adapters():
        discovered_models: list[HarnessModel] | None = None
        if adapter.is_installed():
            try:
                discovered_models = await adapter.list_models()
            except (OSError, asyncio.TimeoutError, RuntimeError) as exc:
                import logging

                logging.getLogger("afaq").warning("adapter_discovery_failed harness=%s error=%s", adapter.name, exc)
                discovered_models = None

        # 1. Local discovery is authoritative when it succeeds and returns models
        if discovered_models:
            MODEL_CACHE[adapter.name] = discovered_models
            if redis_client:
                try:
                    await redis_client.set(
                        _redis_key(adapter.name),
                        json.dumps(_harness_models_to_dicts(discovered_models)),
                        ex=_REDIS_TTL,
                    )
                except REDIS_EXCEPTIONS as exc:
                    import logging

                    logging.getLogger("afaq").warning("redis_cache_mirror_failed error=%s", exc)
        else:
            # 2. Local discovery yielded no usable models or failed:
            # Hydrate an empty cache from Redis if mirror exists, and DO NOT delete valid shared mirror
            hydrated = False
            if redis_client:
                try:
                    raw = await redis_client.get(_redis_key(adapter.name))
                    if raw:
                        dicts = json.loads(raw)
                        if isinstance(dicts, list) and dicts:
                            cached = _dicts_to_harness_models(dicts)
                            if cached:
                                MODEL_CACHE[adapter.name] = cached
                                hydrated = True
                except (*REDIS_EXCEPTIONS, ValueError, KeyError, TypeError) as exc:
                    import logging

                    logging.getLogger("afaq").warning("redis_hydrate_failed harness=%s error=%s", adapter.name, exc)

            if not hydrated:
                MODEL_CACHE[adapter.name] = discovered_models if discovered_models is not None else []
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
    """Return cached models for harness. Always non-blocking, serves local hot cache."""
    return MODEL_CACHE.get(adapter_name, [])


def cached_models_clear(adapter_name: str) -> None:
    """Drop the cached model list for a single harness in local hot cache."""
    MODEL_CACHE.pop(adapter_name, None)


async def clear_model_cache_mirror(adapter_name: str) -> None:
    """Clear local model cache and Redis mirror asynchronously."""
    MODEL_CACHE.pop(adapter_name, None)
    try:
        from app.core.redis import REDIS_EXCEPTIONS, get_redis_client

        rc = await get_redis_client()
        if rc:
            await rc.delete(_redis_key(adapter_name))
    except REDIS_EXCEPTIONS as exc:
        import logging; logging.getLogger("afaq").warning("cache_clear_best_effort error=%s", exc)


def get_adapter(name: str) -> HarnessAdapter:
    if name not in ADAPTERS:
        raise KeyError(f"Unknown harness: {name}")
    return ADAPTERS[name]


def all_adapters() -> list[HarnessAdapter]:
    return list(ADAPTERS.values())
