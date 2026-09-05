import json, time, uuid
from datetime import datetime
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.auth import current_user
from app.core.config import settings
from app.core.security import hash_api_key
from app.db.database import APIKey, UsageRecord, User, get_db
from app.harnesses.registry import cached_models, get_adapter, all_adapters
from app.shared.model_utils import parse_model_identifier as split_model

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

async def resolve_identity(authorization: str | None, db: AsyncSession):
    if not authorization or not authorization.lower().startswith("bearer "):
        return None, None
    raw = authorization.split(" ", 1)[1].strip()
    if not raw:
        return None, None
    # Dashboard JWT has 2 dots (header.payload.signature), API keys start with afaq_ and have no dots.
    # Try JWT first when it looks like a JWT to avoid unnecessary DB lookup and to support dashboard
    # chat without requiring an API key.
    if raw.count(".") == 2:
        try:
            payload = jwt.decode(raw, settings.secret_key, algorithms=["HS256"])
            user_id = int(payload.get("sub"))
            user = await db.get(User, user_id)
            if user and user.is_active:
                return user.id, None
        except (JWTError, TypeError, ValueError):
            pass
        # If JWT-shaped but invalid/expired, fall through to API-key check before giving up
    digest = hash_api_key(raw)
    key = (await db.execute(select(APIKey).where(APIKey.key_hash == digest, APIKey.is_active == True))).scalar_one_or_none()
    if key:
        return key.user_id, key.id
    # Fallback: try JWT decode even if not 3-part (e.g., future token formats)
    try:
        payload = jwt.decode(raw, settings.secret_key, algorithms=["HS256"])
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        return None, None
    user = await db.get(User, user_id)
    return (user.id, None) if user and user.is_active else (None, None)

def make_id(prefix="chatcmpl"):
    return f"{prefix}-{uuid.uuid4().hex}"

@router.get("/models")
async def models():
    data = []
    for adapter in all_adapters():
        for model in cached_models(adapter.name):
            data.append({"id": model.id, "object": "model", "created": int(time.time()), "owned_by": model.harness})
    return {"object": "list", "data": data}

@router.post("/chat/completions")
async def chat_completions(req: ChatRequest, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    user_id, key_id = await resolve_identity(authorization, db)
    if not user_id:
        raise HTTPException(401, "Authentication required. Please sign in or provide a valid API key.")
    harness_name, model = split_model(req.model)
    try: adapter = get_adapter(harness_name)
    except KeyError: raise HTTPException(400, f"Unknown harness: {harness_name}")
    # Extract system messages if provided, otherwise use default system prompt
    system_parts = [m.content for m in req.messages if m.role == "system"]
    system_prompt = "\n".join(system_parts) if system_parts else settings.default_system_prompt
    # Build prompt with system on top, then other messages
    other = [m for m in req.messages if m.role != "system"]
    history_prompt = "\n".join(f"{m.role}: {m.content}" for m in other)
    prompt = f"SYSTEM: {system_prompt}\n\n{history_prompt}" if system_prompt else history_prompt
    completion_id = make_id()
    if req.stream:
        async def event_stream():
            started = time.monotonic(); collected = []
            try:
                async for text, metadata in adapter.stream(prompt, model):
                    collected.append(text)
                    chunk = {"id": completion_id, "object": "chat.completion.chunk", "created": int(time.time()), "model": req.model, "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}]}
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                final = {"id": completion_id, "object": "chat.completion.chunk", "created": int(time.time()), "model": req.model, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
                yield f"data: {json.dumps(final)}\n\ndata: [DONE]\n\n"
                db.add(UsageRecord(user_id=user_id, api_key_id=key_id, harness=harness_name, model=req.model, prompt_tokens=len(prompt.split()), completion_tokens=len("".join(collected).split()), total_tokens=len(prompt.split())+len("".join(collected).split()), latency_ms=int((time.monotonic()-started)*1000)))
                await db.commit()
            except Exception as exc:
                err = {"error": {"message": str(exc), "type": "harness_error"}}
                yield f"data: {json.dumps(err)}\n\n"
        return StreamingResponse(event_stream(), media_type="text/event-stream")
    started = time.monotonic()
    try: result = await adapter.run(prompt, model)
    except Exception as exc: raise HTTPException(502, str(exc))
    usage = {"prompt_tokens": result.prompt_tokens or len(prompt.split()), "completion_tokens": result.completion_tokens or len(result.text.split()), "total_tokens": 0, "cached_tokens": result.cached_tokens}
    usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
    db.add(UsageRecord(user_id=user_id, api_key_id=key_id, harness=harness_name, model=req.model, prompt_tokens=usage["prompt_tokens"], completion_tokens=usage["completion_tokens"], cached_tokens=usage["cached_tokens"], total_tokens=usage["total_tokens"], latency_ms=int((time.monotonic()-started)*1000)))
    await db.commit()
    return {"id": completion_id, "object": "chat.completion", "created": int(time.time()), "model": req.model, "choices": [{"index": 0, "message": {"role": "assistant", "content": result.text}, "finish_reason": "stop"}], "usage": usage}
