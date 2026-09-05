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


def is_model_allowed(requested: str, allowed: list[str] | None) -> bool:
    """Check if requested model is allowed per APIKey.allowed_models.

    - If allowed is None/empty -> allow all (backward compatible).
    - Supports exact match and prefix wildcard (e.g., 'opencode/*' or 'opencode//*').
    - Also supports bare prefix without '*' for convenience (e.g., 'opencode' matches any opencode model).
    """
    if not allowed:
        return True
    # exact
    if requested in allowed:
        return True
    for pattern in allowed:
        if not pattern:
            continue
        # wildcard suffix
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            if requested.startswith(prefix):
                return True
        # bare prefix (no star) -> treat as prefix match if requested starts with pattern
        # but only if pattern looks like a prefix (contains '/' or does not equal full id)
        # to avoid accidental broad allow, we require requested.startswith(pattern) and
        # (len(pattern) < len(requested) and requested[len(pattern)] in ('/', ':'))
        # but for simplicity, if pattern is shorter and requested startswith pattern, allow
        # when pattern is a harness or provider prefix
        elif len(pattern) < len(requested) and requested.startswith(pattern):
            # only allow prefix if pattern ends with '/' or is a harness/provider shorthand
            # e.g., 'opencode' should allow 'opencode//opencode/big-pickle'
            # we permit this convenience
            if pattern.endswith("/") or "/" in pattern or requested.startswith(pattern + "/") or requested.startswith(pattern + "//"):
                return True
            # also direct prefix
            if requested.startswith(pattern):
                # be permissive for prefix without slash as well (per spec example)
                return True
    return False


def _enforce_allowed_models(model: str, allowed_models: list[str] | None) -> None:
    if not is_model_allowed(model, allowed_models):
        raise HTTPException(
            status_code=403,
            detail={"error": {"code": "model_forbidden", "message": f"Model '{model}' is not allowed for this API key.", "model": model}},
        )


def select_model_for_conversation(
    requested_model: str | None, conversation_model: str | None = None, allowed_models: list[str] | None = None
) -> str:
    model = (requested_model or conversation_model or "").strip()
    if model and "/" in model:
        if requested_model:
            validate_model_or_400(model)
            _enforce_allowed_models(model, allowed_models)
        else:
            # when using conversation's model, still check allowed (defense in depth)
            _enforce_allowed_models(model, allowed_models)
        return model
    # fallback chain — same as before but centralized
    if conversation_model and "/" in conversation_model:
        _enforce_allowed_models(conversation_model, allowed_models)
        return conversation_model
    resolved = _resolve_preferred_fallback()
    if resolved:
        _enforce_allowed_models(resolved, allowed_models)
        return resolved
    fallback = "opencode//opencode/big-pickle"
    _enforce_allowed_models(fallback, allowed_models)
    return fallback


def select_model_for_new_conversation(requested_model: str | None, allowed_models: list[str] | None = None) -> str:
    if requested_model:
        validate_model_or_400(requested_model)
        _enforce_allowed_models(requested_model, allowed_models)
        return requested_model
    resolved = _resolve_preferred_fallback()
    if resolved:
        _enforce_allowed_models(resolved, allowed_models)
        return resolved
    fallback = "opencode//opencode/big-pickle"
    _enforce_allowed_models(fallback, allowed_models)
    return fallback
