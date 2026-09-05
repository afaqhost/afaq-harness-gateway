import json
import time
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.auth import current_user
from app.db.database import Conversation, Message, UsageRecord, User, get_db
from app.harnesses.registry import get_adapter, cached_models, all_adapters

router = APIRouter()

# ---------- Schemas ----------
class ConversationCreate(BaseModel):
    title: str | None = None
    model: str | None = None

class ConversationUpdate(BaseModel):
    title: str | None = None
    model: str | None = None

class MessageCreate(BaseModel):
    content: str
    model: str | None = None
    stream: bool = False

class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime
    class Config:
        from_attributes = True

class ConversationOut(BaseModel):
    id: int
    title: str
    model: str
    created_at: datetime
    updated_at: datetime
    message_count: int | None = None
    last_message: str | None = None
    class Config:
        from_attributes = True

class ConversationDetail(ConversationOut):
    messages: list[MessageOut]

def split_model(model: str):
    parts = model.split("/", 2)
    if len(parts) == 3:
        return parts[0], parts[2]
    if len(parts) == 2:
        return parts[0], parts[1]
    return parts[0], "default"

def _validate_model_or_400(full_model: str) -> tuple[str, str]:
    """Validate that harness exists and model is known. Raises HTTPException 400 if invalid."""
    harness_name, model_name = split_model(full_model)
    # Unknown harness
    try:
        get_adapter(harness_name)
    except KeyError:
        raise HTTPException(400, f"Unknown harness: {harness_name}. المتاح: {', '.join(a.name for a in all_adapters())}")
    # Temporarily mark codex as unavailable due to transport errors (502)
    if harness_name == "codex":
        raise HTTPException(400, f"الموديل '{full_model}' من harness 'codex' غير متاح حالياً (خطأ transport). جرب opencode//opencode/big-pickle أو commandcode//deepseek/deepseek-v4-flash")
    # If we have cached models for this harness, check that full id is known
    # This prevents hanging on non-existent ollama models like ollama/qwen2.5-coder:7b
    cached = cached_models(harness_name)
    if cached:
        ids = {m.id for m in cached}
        # also allow short form without harness prefix inside model_name?
        if full_model not in ids:
            # Provide top 5 suggestions
            sample = ", ".join(m.id for m in cached[:5])
            raise HTTPException(400, f"الموديل '{full_model}' غير متوفر للـ harness '{harness_name}'. جرب أحد هذه: {sample} ... (أعد تحميل الموديلات من /v1/models)")
    return harness_name, model_name

def _preview(text: str, n: int = 80) -> str:
    t = text.strip().replace("\n", " ")
    return t[:n] + ("…" if len(t) > n else "")

# ---------- Helpers ----------
async def _get_conversation_or_404(conv_id: int, user: User, db: AsyncSession) -> Conversation:
    conv = await db.get(Conversation, conv_id)
    if not conv or conv.user_id != user.id:
        raise HTTPException(404, "Conversation not found")
    return conv

async def _conversation_to_out(conv: Conversation, db: AsyncSession) -> ConversationOut:
    from sqlalchemy import func
    count = await db.scalar(select(func.count()).select_from(Message).where(Message.conversation_id == conv.id)) or 0
    msgs = await db.execute(
        select(Message).where(Message.conversation_id == conv.id).order_by(desc(Message.created_at)).limit(1)
    )
    last = msgs.scalar_one_or_none()
    return ConversationOut(
        id=conv.id,
        title=conv.title,
        model=conv.model,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        message_count=count,
        last_message=_preview(last.content) if last else None,
    )

# ---------- Endpoints ----------
@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Conversation).where(Conversation.user_id == user.id).order_by(desc(Conversation.updated_at))
    )
    convs = result.scalars().all()
    out = []
    for c in convs:
        out.append(await _conversation_to_out(c, db))
    return out

@router.post("/conversations", response_model=ConversationOut)
async def create_conversation(data: ConversationCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    model = data.model
    if model:
        # Validate explicitly provided model (fail fast for broken codex)
        _validate_model_or_400(model)
    if not model:
        # Prefer known working models: opencode/big-pickle first
        preferred = ["opencode//opencode/big-pickle", "opencode//opencode/claude-sonnet-4", "commandcode//deepseek/deepseek-v4-flash"]
        for pref in preferred:
            h, _ = split_model(pref)
            if any(m.id == pref for m in cached_models(h)):
                model = pref
                break
        if not model:
            for adapter in all_adapters():
                # Skip broken codex by default unless explicitly requested
                if adapter.name == "codex":
                    continue
                models = cached_models(adapter.name)
                if models:
                    model = models[0].id
                    break
        # Finally allow codex if nothing else
        if not model:
            for adapter in all_adapters():
                models = cached_models(adapter.name)
                if models:
                    model = models[0].id
                    break
        if not model:
            model = "opencode//opencode/big-pickle"
    title = data.title or "New chat"
    conv = Conversation(user_id=user.id, title=title, model=model)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return await _conversation_to_out(conv, db)

@router.get("/conversations/{conv_id}", response_model=ConversationDetail)
async def get_conversation(conv_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv = await _get_conversation_or_404(conv_id, user, db)
    result = await db.execute(select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at))
    msgs = result.scalars().all()
    base = await _conversation_to_out(conv, db)
    return ConversationDetail(
        **base.model_dump(),
        messages=[MessageOut.model_validate(m) for m in msgs],
    )

@router.patch("/conversations/{conv_id}", response_model=ConversationOut)
async def update_conversation(conv_id: int, data: ConversationUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv = await _get_conversation_or_404(conv_id, user, db)
    if data.title is not None:
        conv.title = data.title.strip() or conv.title
    if data.model is not None:
        conv.model = data.model
    conv.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(conv)
    return await _conversation_to_out(conv, db)

@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(conv_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv = await _get_conversation_or_404(conv_id, user, db)
    await db.delete(conv)
    await db.commit()

@router.post("/conversations/{conv_id}/messages")
async def send_message(conv_id: int, data: MessageCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv = await _get_conversation_or_404(conv_id, user, db)
    content = data.content.strip()
    if not content:
        raise HTTPException(400, "Message content required")
    if len(content) > 20000:
        raise HTTPException(400, "Message too long (max 20000 chars)")
    model = (data.model or conv.model or "").strip()
    if not model or "/" not in model:
        model = conv.model
        if not model or "/" not in model:
            preferred = ["opencode//opencode/big-pickle", "opencode//opencode/claude-sonnet-4", "commandcode//deepseek/deepseek-v4-flash"]
            for pref in preferred:
                h, _ = split_model(pref)
                if any(m.id == pref for m in cached_models(h)):
                    model = pref
                    break
            if not model:
                for ad in all_adapters():
                    if ad.name == "codex":
                        continue
                    ms = cached_models(ad.name)
                    if ms:
                        model = ms[0].id
                        break
            if not model:
                for ad in all_adapters():
                    ms = cached_models(ad.name)
                    if ms:
                        model = ms[0].id
                        break
            if not model:
                model = "opencode//opencode/big-pickle"
    if model != conv.model:
        conv.model = model
    is_first = (await db.execute(select(Message).where(Message.conversation_id == conv.id).limit(1))).scalar_one_or_none() is None
    if is_first or conv.title in ("New chat", "محادثة جديدة", ""):
        conv.title = _preview(content, 50)
    conv.updated_at = datetime.utcnow()
    user_msg = Message(conversation_id=conv.id, role="user", content=content)
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(conv)

    result = await db.execute(select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at))
    history = result.scalars().all()
    history_prompt = "\n".join(f"{m.role}: {m.content}" for m in history)
    # Prepend default system prompt so AI always returns text with file names + code blocks
    from app.core.config import settings as _settings
    system_prompt = _settings.default_system_prompt
    prompt = f"SYSTEM: {system_prompt}\n\n{history_prompt}" if system_prompt else history_prompt

    harness_name, model_name = _validate_model_or_400(model)
    adapter = get_adapter(harness_name)

    if data.stream:
        pass

    started = time.monotonic()
    try:
        result_h = await adapter.run(prompt, model_name)
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc)
        # Timeout → 504, otherwise 502
        status = 504 if "timed out" in msg.lower() or "timeout" in msg.lower() else 502
        err_text = f"⚠️ Harness error: {msg}"
        err_msg = Message(conversation_id=conv.id, role="assistant", content=err_text)
        db.add(err_msg)
        conv.updated_at = datetime.utcnow()
        await db.commit()
        raise HTTPException(status, msg)

    assistant_msg = Message(conversation_id=conv.id, role="assistant", content=result_h.text or "(no response)")
    db.add(assistant_msg)
    conv.updated_at = datetime.utcnow()

    usage = {
        "prompt_tokens": result_h.prompt_tokens or len(prompt.split()),
        "completion_tokens": result_h.completion_tokens or len((result_h.text or "").split()),
        "cached_tokens": result_h.cached_tokens or 0,
    }
    usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
    db.add(
        UsageRecord(
            user_id=user.id,
            api_key_id=None,
            harness=harness_name,
            model=model,
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
            cached_tokens=usage["cached_tokens"],
            total_tokens=usage["total_tokens"],
            latency_ms=int((time.monotonic() - started) * 1000),
        )
    )

    await db.commit()
    await db.refresh(assistant_msg)
    await db.refresh(conv)

    return {
        "conversation": (await _conversation_to_out(conv, db)).model_dump(),
        "message": MessageOut.model_validate(assistant_msg).model_dump(),
        "usage": usage,
    }

@router.post("/conversations/{conv_id}/messages/stream")
async def stream_message(conv_id: int, data: MessageCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv = await _get_conversation_or_404(conv_id, user, db)
    content = data.content.strip()
    if not content:
        raise HTTPException(400, "Message content required")
    if len(content) > 20000:
        raise HTTPException(400, "Message too long")
    model = (data.model or conv.model or "").strip()
    if not model or "/" not in model:
        model = conv.model
        if not model or "/" not in model:
            preferred = ["opencode//opencode/big-pickle", "opencode//opencode/claude-sonnet-4", "commandcode//deepseek/deepseek-v4-flash"]
            for pref in preferred:
                h, _ = split_model(pref)
                if any(m.id == pref for m in cached_models(h)):
                    model = pref
                    break
            if not model:
                for ad in all_adapters():
                    if ad.name == "codex":
                        continue
                    ms = cached_models(ad.name)
                    if ms:
                        model = ms[0].id
                        break
            if not model:
                for ad in all_adapters():
                    ms = cached_models(ad.name)
                    if ms:
                        model = ms[0].id
                        break
            if not model:
                model = "opencode//opencode/big-pickle"
    # Validate model before persisting user message — fail fast with 400 for unknown models
    harness_name, model_name = _validate_model_or_400(model)
    adapter = get_adapter(harness_name)
    if model != conv.model:
        conv.model = model
    is_first = (await db.execute(select(Message).where(Message.conversation_id == conv.id).limit(1))).scalar_one_or_none() is None
    if is_first or conv.title in ("New chat", "محادثة جديدة", ""):
        conv.title = _preview(content, 50)
    conv.updated_at = datetime.utcnow()
    user_msg = Message(conversation_id=conv.id, role="user", content=content)
    db.add(user_msg)
    await db.flush()
    await db.commit()

    result = await db.execute(select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at))
    history = result.scalars().all()
    history_prompt = "\n".join(f"{m.role}: {m.content}" for m in history)
    from app.core.config import settings as _settings2
    system_prompt2 = _settings2.default_system_prompt
    prompt = f"SYSTEM: {system_prompt2}\n\n{history_prompt}" if system_prompt2 else history_prompt

    async def event_stream():
        from app.db.database import SessionLocal
        collected = []
        started = time.monotonic()
        has_error = False
        try:
            async for text, metadata in adapter.stream(prompt, model_name):
                if not text:
                    continue
                collected.append(text)
                chunk = {
                    "id": conv.id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
                }
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            # If stream finished without delta, treat as error rather than "(no response)"
            if not collected:
                raise RuntimeError("Harness returned empty response — لا يوجد رد من الموديل. جرب موديل آخر مثل opencode/big-pickle")
            final = {
                "id": conv.id,
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(final)}\n\ndata: [DONE]\n\n"
            async with SessionLocal() as session:
                full_text = "".join(collected)
                msg = Message(conversation_id=conv.id, role="assistant", content=full_text)
                session.add(msg)
                conv2 = await session.get(Conversation, conv.id)
                if conv2:
                    conv2.updated_at = datetime.utcnow()
                session.add(
                    UsageRecord(
                        user_id=user.id,
                        api_key_id=None,
                        harness=harness_name,
                        model=model,
                        prompt_tokens=len(prompt.split()),
                        completion_tokens=len(full_text.split()),
                        total_tokens=len(prompt.split()) + len(full_text.split()),
                        latency_ms=int((time.monotonic() - started) * 1000),
                    )
                )
                await session.commit()
        except Exception as exc:
            has_error = True
            # Persist error as assistant message so user sees it after reload
            try:
                async with SessionLocal() as session:
                    err_text = f"⚠️ {str(exc)}"
                    msg = Message(conversation_id=conv.id, role="assistant", content=err_text)
                    session.add(msg)
                    conv2 = await session.get(Conversation, conv.id)
                    if conv2:
                        conv2.updated_at = datetime.utcnow()
                    await session.commit()
            except Exception:
                pass
            err = {"error": {"message": str(exc), "type": "harness_error"}}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
