"""Business rules around model selection and validation.

Controllers call here instead of duplicating preferred-model lists or
harness-availability checks. The service depends on the adapter registry
but hides that detail behind intent-revealing functions.
"""

from __future__ import annotations

from fastapi import HTTPException

from app.clients.registry import all_adapters, cached_models, get_adapter
from app.shared.model_utils import parse_model_identifier

PREFERRED_MODELS = [
    "opencode//opencode/big-pickle",
    "opencode//opencode/claude-sonnet-4",
    "commandcode//deepseek/deepseek-v4-flash",
]

CODEX_UNAVAILABLE_MESSAGE = (
    "الموديل '{model}' من harness 'codex' غير متاح حالياً (خطأ transport). "
    "جرب opencode//opencode/big-pickle أو commandcode//deepseek/deepseek-v4-flash"
)


def _resolve_preferred_fallback() -> str | None:
    for pref in PREFERRED_MODELS:
        harness, _ = parse_model_identifier(pref)
        if any(m.id == pref for m in cached_models(harness)):
            return pref
    for adapter in all_adapters():
        if adapter.name == "codex":
            continue
        models = cached_models(adapter.name)
        if models:
            return models[0].id
    for adapter in all_adapters():
        models = cached_models(adapter.name)
        if models:
            return models[0].id
    return None


def validate_model_or_400(full_model: str) -> tuple[str, str]:
    harness_name, model_name = parse_model_identifier(full_model)
    try:
        get_adapter(harness_name)
    except KeyError:
        raise HTTPException(400, f"Unknown harness: {harness_name}. المتاح: {', '.join(a.name for a in all_adapters())}") from None
    if harness_name == "codex":
        raise HTTPException(400, CODEX_UNAVAILABLE_MESSAGE.format(model=full_model))
    cached = cached_models(harness_name)
    if cached:
        ids = {m.id for m in cached}
        if full_model not in ids:
            sample = ", ".join(m.id for m in cached[:5])
            raise HTTPException(
                400,
                f"الموديل '{full_model}' غير متوفر للـ harness '{harness_name}'. "
                f"جرب أحد هذه: {sample} ... (أعد تحميل الموديلات من /v1/models)",
            )
    return harness_name, model_name


def select_model_for_conversation(requested_model: str | None, conversation_model: str | None = None) -> str:
    model = (requested_model or conversation_model or "").strip()
    if model and "/" in model:
        if requested_model:
            validate_model_or_400(model)
        return model
    # fallback chain — same as before but centralized
    if conversation_model and "/" in conversation_model:
        return conversation_model
    resolved = _resolve_preferred_fallback()
    if resolved:
        return resolved
    return "opencode//opencode/big-pickle"


def select_model_for_new_conversation(requested_model: str | None) -> str:
    if requested_model:
        validate_model_or_400(requested_model)
        return requested_model
    resolved = _resolve_preferred_fallback()
    if resolved:
        return resolved
    return "opencode//opencode/big-pickle"
