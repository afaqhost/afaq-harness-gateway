import asyncio
import json
import logging
import time
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_api_key
from app.db.database import APIKey, UsageRecord, User, get_db
from app.harnesses.registry import all_adapters, cached_models, get_adapter
from app.services import credential_service, quota_service
try:
    from app.api.metrics import HARNESS_CALLS, HARNESS_LATENCY
except ImportError:
    HARNESS_CALLS = None
    HARNESS_LATENCY = None
from app.services.model_service import is_model_allowed, validate_model_or_400
from app.shared.errors import sanitize_harness_error
from app.shared.model_utils import parse_model_identifier as split_model
from app.shared.prompt_utils import build_harness_prompt, build_history_prompt

logger = logging.getLogger("afaq")

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class FunctionDef(BaseModel):
    name: str
    description: str | None = None
    parameters: dict | None = None


class ToolDef(BaseModel):
    type: str = "function"
    function: FunctionDef


class ResponseFormat(BaseModel):
    type: str  # "json_object" | "json_schema"
    json_schema: dict | None = None  # for json_schema, contains {"name":..., "schema":...} or raw schema


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    stream: bool = False
    temperature: float | None = None
    max_tokens: int | None = None
    user: str | None = None
    metadata: dict | None = None
    tools: list[ToolDef] | None = None
    tool_choice: str | dict | None = None
    response_format: ResponseFormat | None = None

    @field_validator("tool_choice")
    @classmethod
    def validate_tool_choice(cls, v):
        if v is None:
            return v
        if isinstance(v, str):
            if v not in ("auto", "none", "required"):
                raise ValueError("tool_choice must be auto, none, required or function dict")
            return v
        if isinstance(v, dict):
            # allow {"type":"function","function":{"name":...}}
            if v.get("type") == "function" and isinstance(v.get("function"), dict) and v["function"].get("name"):
                return v
            raise ValueError("invalid tool_choice function dict")
        raise ValueError("invalid tool_choice")

    @field_validator("response_format")
    @classmethod
    def validate_response_format(cls, v):
        if v is None:
            return v
        if v.type not in ("json_object", "json_schema"):
            raise ValueError("response_format type must be json_object or json_schema")
        return v


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
async def chat_completions(
    request_payload: ChatRequest,
    request: Request,
    authorization: str | None = Header(default=None),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    db: AsyncSession = Depends(get_db),
):
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
            _stream_response(adapter, prompt, model, request_payload.model, completion_id, user_id, key_id, harness_name, db, request, last_event_id, request_payload),
            media_type="text/event-stream",
            headers={"X-Request-ID": completion_id},
        )

    return await _non_stream_response(adapter, prompt, model, request_payload.model, completion_id, user_id, key_id, harness_name, db, request, request_payload)


async def _stream_response(
    adapter, prompt: str, model: str, request_model: str, completion_id: str, user_id: int, key_id, harness_name: str, db: AsyncSession, request: Request, last_event_id: str | None = None, request_payload: ChatRequest | None = None
):
    started = time.monotonic()
    collected: list[str] = []

    async def event_stream():
        from app.services.process_registry import process_registry
        from app.shared.sse import sse_event

        history_key = f"openai:{user_id}"
        seq = 1

        def _store(event: str, data, id_val: int | None = None, retry: int | None = None) -> str:
            if retry is None:
                retry = settings.sse_retry_ms
            payload = sse_event(event, data, id=id_val, retry=retry)
            try:
                process_registry.append_history(history_key, id_val if id_val is not None else seq, payload)
            except (OSError, RuntimeError) as exc:
                import logging; logging.getLogger("afaq").warning("metrics_failed error=%s", exc)
            return payload

        # replay from Last-Event-ID
        if last_event_id is not None:
            try:
                last_id = int(last_event_id)
                for rp in process_registry.get_replay(history_key, last_id):
                    yield rp
                hist = process_registry.get_history(history_key)
                if hist:
                    seq = max(s for s, _ in hist) + 1
                else:
                    seq = last_id + 1
            except ValueError:
                pass

        # start lifecycle
        start_data = {"id": completion_id, "model": request_model, "created": int(time.time())}
        yield _store("start", start_data, id_val=seq, retry=settings.sse_retry_ms)
        seq += 1

        cancelled = False
        had_tool_call = False
        # env injection for harness
        env = await credential_service.get_env_for_harness(db, user_id, harness_name)
        stream_iter = adapter.stream(prompt, model, request_id=completion_id, env=env).__aiter__()
        pending = None
        try:
            while True:
                if await request.is_disconnected():
                    logger.info("client_disconnected cancelling completion_id=%s", completion_id)
                    await process_registry.cancel(completion_id)
                    cancelled = True
                    if pending:
                        pending.cancel()
                    yield _store("cancel", {"code": "cancelled", "message": "cancelled by client"}, id_val=seq)
                    break
                if pending is None:
                    pending = asyncio.create_task(stream_iter.__anext__())
                done, _ = await asyncio.wait([pending], timeout=settings.sse_heartbeat_seconds)
                if not done:
                    yield ": keepalive\n\n"
                    continue
                try:
                    text, metadata = pending.result()
                except StopAsyncIteration:
                    break
                pending = None

                if await request.is_disconnected():
                    await process_registry.cancel(completion_id)
                    cancelled = True
                    yield _store("cancel", {"code": "cancelled", "message": "cancelled by client"}, id_val=seq)
                    break

                # tool_call handling
                if "tool_call" in metadata:
                    had_tool_call = True
                    tc = metadata["tool_call"]
                    # ensure normalized
                    if isinstance(tc, dict) and "function" in tc:
                        func = tc["function"]
                    else:
                        func = {"name": str(tc.get("name", "unknown")), "arguments": tc.get("arguments", "")}
                        tc = {"id": str(tc.get("id", f"call_{seq}")), "type": "function", "function": func}
                    tool_chunk = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": request_model,
                        "choices": [{"index": 0, "delta": {"tool_calls": [{"id": tc["id"], "type": "function", "function": tc["function"]}]}, "finish_reason": None}],
                    }
                    yield _store("tool_call", tool_chunk, id_val=seq, retry=settings.sse_retry_ms)
                    seq += 1
                    # stub tool_result
                    result_payload = {"tool_call_id": tc["id"], "status": "requires_action", "content": "requires_action"}
                    yield _store("tool_result", result_payload, id_val=seq, retry=settings.sse_retry_ms)
                    seq += 1
                    continue

                if not text:
                    continue
                collected.append(text)
                chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": request_model,
                    "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
                }
                yield _store("token", chunk, id_val=seq, retry=settings.sse_retry_ms)
                seq += 1

            if cancelled:
                return
            if not collected and not had_tool_call:
                raise RuntimeError("Harness returned empty response — لا يوجد رد من الموديل. جرب موديل آخر مثل opencode/big-pickle")

            usage_data = {
                "prompt_tokens": len(prompt.split()),
                "completion_tokens": len("".join(collected).split()),
                "total_tokens": len(prompt.split()) + len("".join(collected).split()),
                "harness": harness_name,
                "model": request_model,
            }
            if HARNESS_CALLS:
                try:
                    HARNESS_CALLS.labels(harness=harness_name, model=request_model).inc()
                    if HARNESS_LATENCY:
                        HARNESS_LATENCY.labels(harness=harness_name).observe(int((time.monotonic() - started) * 1000))
                except (OSError, RuntimeError) as exc:
                    import logging; logging.getLogger("afaq").warning("metrics_best_effort error=%s", exc)
            yield _store("usage", usage_data, id_val=seq, retry=settings.sse_retry_ms)
            seq += 1

            yield _store("done", "[DONE]", id_val=seq, retry=settings.sse_retry_ms)

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
            msg_lower = str(exc).lower()
            is_killed = "exit code -9" in msg_lower or "exit code -15" in msg_lower or "killed" in msg_lower
            if cancelled or "cancel" in msg_lower or is_killed:
                logger.info("stream_cancelled completion_id=%s error=%s", completion_id, str(exc))
                yield _store("cancel", {"code": "cancelled", "message": "cancelled"}, id_val=seq)
                return
            logger.error("harness_stream_error harness=%s model=%s error=%s", harness_name, model, str(exc))
            sanitized = sanitize_harness_error(exc)
            err = {"code": "harness_error", "message": sanitized, "type": "harness_error"}
            yield _store("error", err, id_val=seq)

    async for chunk in event_stream():
        yield chunk


@router.post("/chat/completions/{completion_id}/cancel")
async def cancel_completion(completion_id: str, request: Request, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    user_id, key_id = await resolve_identity(authorization, db)
    if not user_id:
        raise HTTPException(status_code=401, detail={"error": {"code": "auth_error", "message": "Authentication required"}})
    from app.services.process_registry import process_registry

    ok = await process_registry.cancel(completion_id)
    if ok:
        return {"status": "cancelled", "completion_id": completion_id}
    # also try without prefix if client sent full?
    raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "No in-flight stream"}})


async def _non_stream_response(adapter, prompt: str, model: str, request_model: str, completion_id: str, user_id: int, key_id, harness_name: str, db: AsyncSession, request: Request, request_payload: ChatRequest | None = None):
    started = time.monotonic()
    # env injection
    env = await credential_service.get_env_for_harness(db, user_id, harness_name)
    # structured output handling: prepare to validate after run
    fmt = request_payload.response_format if request_payload else None
    try:
        result = await adapter.run(prompt, model, request_id=completion_id, env=env)
        if HARNESS_CALLS:
            try:
                HARNESS_CALLS.labels(harness=harness_name, model=request_model).inc()
                if HARNESS_LATENCY:
                    HARNESS_LATENCY.labels(harness=harness_name).observe(int((time.monotonic() - started) * 1000))
            except (OSError, RuntimeError) as exc:
                import logging; logging.getLogger("afaq").warning("metrics_failed error=%s", exc)
        # structured output validation with one retry
        if fmt is not None:
            from app.shared.structured_output import validate_json_response

            validated = validate_json_response(result.text, fmt)
            if validated is None:
                # retry once with suffix
                try:
                    retry_prompt = prompt + "\n\nRespond with valid JSON only."
                    result_retry = await adapter.run(retry_prompt, model, request_id=completion_id + "-retry", env=env)
                    validated2 = validate_json_response(result_retry.text, fmt)
                    if validated2 is None:
                        raise HTTPException(status_code=502, detail={"error": {"code": "malformed_output", "message": "Model did not return valid JSON for response_format"}})
                    result = result_retry
                except HTTPException:
                    raise
                except (OSError, RuntimeError, ValueError) as exc:
                    import logging; logging.getLogger("afaq").warning("retry_failed error=%s", exc)
                    raise HTTPException(status_code=502, detail={"error": {"code": "malformed_output", "message": "Model did not return valid JSON for response_format"}})
            else:
                # if validated, keep result but ensure text is JSON dump of validated
                pass
    except HTTPException:
        raise
    except RuntimeError as exc:
        logger.error("harness_error harness=%s model=%s error=%s", harness_name, model, str(exc))
        sanitized = sanitize_harness_error(exc)
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

    # tool_calls handling for non-stream
    if request_payload and request_payload.tools:
        tool_calls = None
        # try to parse result.text as tool JSON
        try:
            maybe = json.loads(result.text) if result.text else None
            if isinstance(maybe, dict) and ("tool" in maybe or "tool_call" in maybe or "function" in maybe):
                tc_raw = maybe.get("tool") or maybe.get("tool_call") or maybe
                if isinstance(tc_raw, dict):
                    # if tc_raw is like {"id":..., "function": {"name":..., "arguments":...}}
                    if "function" in tc_raw:
                        func = tc_raw["function"]
                        tc_id = tc_raw.get("id", "call_1")
                        tool_calls = [{"id": str(tc_id), "type": "function", "function": {"name": func.get("name", "unknown"), "arguments": func.get("arguments", "") if isinstance(func.get("arguments"), str) else json.dumps(func.get("arguments", ""))}}]
                    elif "name" in tc_raw:
                        tool_calls = [{"id": tc_raw.get("id", "call_1"), "type": "function", "function": {"name": tc_raw["name"], "arguments": tc_raw.get("arguments", "") if isinstance(tc_raw.get("arguments"), str) else json.dumps(tc_raw.get("arguments", ""))}}]
        except (ValueError, TypeError, KeyError) as exc:
            import logging; logging.getLogger("afaq").warning("tool_parse_failed error=%s", exc)
        if tool_calls is None and isinstance(result.raw, dict) and "tool_call" in result.raw:
            tc = result.raw["tool_call"]
            tool_calls = [{"id": tc.get("id", "call_1"), "type": "function", "function": tc.get("function", {"name": "unknown", "arguments": ""})}]
        if tool_calls is not None:
            return {
                "id": completion_id,
                "object": "chat.completion",
                "created": int(time.time()),
                "model": request_model,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": None, "tool_calls": tool_calls}, "finish_reason": "tool_calls"}],
                "usage": usage,
            }

    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": request_model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": result.text}, "finish_reason": "stop"}],
        "usage": usage,
    }
