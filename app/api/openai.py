import json
import logging
import time
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_api_key
from app.db.database import APIKey, UsageRecord, User, get_db
from app.harnesses.registry import all_adapters, cached_models, get_adapter
from app.services import quota_service
from app.services.model_service import is_model_allowed, validate_model_or_400
from app.shared.model_utils import parse_model_identifier as split_model
from app.shared.prompt_utils import build_harness_prompt, build_history_prompt

logger = logging.getLogger("afaq")

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    stream: bool = False
    temperature: float | None = None
    max_tokens: int | None = None
    user: str | None = None
    metadata: dict | None = None


async def _try_jwt_identity(raw_token: str, db: AsyncSession) -> int | None:
    try:
        payload = jwt.decode(raw_token, settings.secret_key, algorithms=["HS256"])
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        return None
    user = await db.get(User, user_id)
    return user.id if user and user.is_active else None


async def resolve_identity(authorization: str | None, db: AsyncSession) -> tuple[int | None, int | None]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None, None
    raw = authorization.split(" ", 1)[1].strip()
    if not raw:
        return None, None
    if raw.count(".") == 2:
        user_id = await _try_jwt_identity(raw, db)
        if user_id:
            return user_id, None
    digest = hash_api_key(raw)
    key = (
        await db.execute(select(APIKey).where(APIKey.key_hash == digest, APIKey.is_active == True))
    ).scalar_one_or_none()
    if key:
        return key.user_id, key.id
    user_id = await _try_jwt_identity(raw, db)
    return (user_id, None) if user_id else (None, None)


def _completion_id(prefix: str = "chatcmpl") -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


def _build_openai_prompt(messages: list[ChatMessage]) -> str:
    system_parts = [m.content for m in messages if m.role == "system"]
    system_prompt = "\n".join(system_parts) if system_parts else settings.default_system_prompt
    other = [(m.role, m.content) for m in messages if m.role != "system"]
    history = build_history_prompt(other)
    return build_harness_prompt(system_prompt, history)


@router.get("/models")
async def models():
    data = []
    for adapter in all_adapters():
        for model in cached_models(adapter.name):
            data.append({"id": model.id, "object": "model", "created": int(time.time()), "owned_by": model.harness})
    return {"object": "list", "data": data}


@router.post("/chat/completions")
async def chat_completions(request_payload: ChatRequest, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    user_id, key_id = await resolve_identity(authorization, db)
    if not user_id:
        raise HTTPException(401, "Authentication required. Please sign in or provide a valid API key.")

    # Enforce per-key quota and allowed_models if using API key
    if key_id is not None:
        api_key = await db.get(APIKey, key_id)
        if api_key:
            await quota_service.enforce_quota(db, api_key)
            if not is_model_allowed(request_payload.model, api_key.allowed_models):
                raise HTTPException(
                    status_code=403,
                    detail={"error": {"code": "model_forbidden", "message": f"Model '{request_payload.model}' is not allowed for this API key."}},
                )

    # Validate model (harness existence, cache, codex block)
    harness_name, model = validate_model_or_400(request_payload.model)
    try:
        adapter = get_adapter(harness_name)
    except KeyError:
        raise HTTPException(400, f"Unknown harness: {harness_name}")

    prompt = _build_openai_prompt(request_payload.messages)
    completion_id = _completion_id()

    if request_payload.stream:
        return StreamingResponse(
            _stream_response(adapter, prompt, model, request_payload.model, completion_id, user_id, key_id, harness_name, db),
            media_type="text/event-stream",
        )

    return await _non_stream_response(adapter, prompt, model, request_payload.model, completion_id, user_id, key_id, harness_name, db)


def _sanitize_harness_error(exc: Exception) -> str:
    msg = str(exc).lower()
    if "ollama" in msg or "model" in msg and "not found" in msg:
        return "Harness failed — check model availability"
    if "timed out" in msg or "timeout" in msg:
        return "Harness timed out — try again or use a different model"
    return "Harness error — please try again later"


async def _stream_response(adapter, prompt: str, model: str, request_model: str, completion_id: str, user_id: int, key_id, harness_name: str, db: AsyncSession):
    started = time.monotonic()
    collected: list[str] = []

    async def event_stream():
        try:
            async for text, metadata in adapter.stream(prompt, model):
                collected.append(text)
                chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": request_model,
                    "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
                }
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            final = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": request_model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(final)}\n\ndata: [DONE]\n\n"
            db.add(
                UsageRecord(
                    user_id=user_id,
                    api_key_id=key_id,
                    harness=harness_name,
                    model=request_model,
                    prompt_tokens=len(prompt.split()),
                    completion_tokens=len("".join(collected).split()),
                    total_tokens=len(prompt.split()) + len("".join(collected).split()),
                    latency_ms=int((time.monotonic() - started) * 1000),
                )
            )
            await db.commit()
        except RuntimeError as exc:
            logger.error("harness_stream_error harness=%s model=%s error=%s", harness_name, model, str(exc))
            sanitized = _sanitize_harness_error(exc)
            err = {"error": {"code": "harness_error", "message": sanitized, "type": "harness_error"}}
            yield f"data: {json.dumps(err)}\n\n"

    async for chunk in event_stream():
        yield chunk


async def _non_stream_response(adapter, prompt: str, model: str, request_model: str, completion_id: str, user_id: int, key_id, harness_name: str, db: AsyncSession):
    started = time.monotonic()
    try:
        result = await adapter.run(prompt, model)
    except RuntimeError as exc:
        logger.error("harness_error harness=%s model=%s error=%s", harness_name, model, str(exc))
        sanitized = _sanitize_harness_error(exc)
        status = 504 if "timed out" in str(exc).lower() or "timeout" in str(exc).lower() else 502
        raise HTTPException(status_code=status, detail={"error": {"code": "harness_error", "message": sanitized}})
    usage = {
        "prompt_tokens": result.prompt_tokens or len(prompt.split()),
        "completion_tokens": result.completion_tokens or len(result.text.split()),
        "total_tokens": 0,
        "cached_tokens": result.cached_tokens,
    }
    usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
    db.add(
        UsageRecord(
            user_id=user_id,
            api_key_id=key_id,
            harness=harness_name,
            model=request_model,
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
            cached_tokens=usage["cached_tokens"],
            total_tokens=usage["total_tokens"],
            latency_ms=int((time.monotonic() - started) * 1000),
        )
    )
    await db.commit()
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": request_model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": result.text}, "finish_reason": "stop"}],
        "usage": usage,
    }
