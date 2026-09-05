import json
import logging
import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import current_user
from app.core.config import settings
from app.core.security import hash_api_key
from app.db.database import APIKey, Conversation, Message, UsageRecord, User, get_db
from app.harnesses.registry import get_adapter
from app.repositories.conversation_repository import (
    fetch_conversation_summary,
    get_conversation_or_404 as repo_get_conversation_or_404,
)
from app.services import quota_service
from app.services.model_service import (
    select_model_for_conversation,
    select_model_for_new_conversation,
    validate_model_or_400,
)
from app.shared.model_utils import preview_text as _preview
from app.shared.prompt_utils import build_harness_prompt, build_history_prompt

logger = logging.getLogger("afaq")


def _sanitize_harness_error(exc: Exception) -> str:
    msg = str(exc).lower()
    if "ollama" in msg or ("model" in msg and "not found" in msg):
        return "Harness failed — check model availability"
    if "timed out" in msg or "timeout" in msg:
        return "Harness timed out — try again or use a different model"
    return "Harness error — please try again later"


async def _resolve_api_key(authorization: str | None, db: AsyncSession) -> APIKey | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    raw = authorization.split(" ", 1)[1].strip()
    if not raw.startswith("afaq_"):
        return None
    digest = hash_api_key(raw)
    return (await db.execute(select(APIKey).where(APIKey.key_hash == digest, APIKey.is_active == True))).scalar_one_or_none()

router = APIRouter()


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


def _validate_model_or_400(full_model: str) -> tuple[str, str]:
    return validate_model_or_400(full_model)


async def _get_conversation_or_404(conv_id: int, user: User, db: AsyncSession) -> Conversation:
    return await repo_get_conversation_or_404(conv_id, user, db)


async def _conversation_to_out(conv: Conversation, db: AsyncSession) -> ConversationOut:
    count, preview = await fetch_conversation_summary(conv, db)
    return ConversationOut(
        id=conv.id,
        title=conv.title,
        model=conv.model,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        message_count=count,
        last_message=preview,
    )


def _maybe_update_title(conv: Conversation, content: str, is_first: bool) -> None:
    if is_first or conv.title in ("New chat", "محادثة جديدة", ""):
        conv.title = _preview(content, 50)


def _history_to_prompt(history: list[Message]) -> str:
    history_prompt = build_history_prompt([(m.role, m.content) for m in history])
    return build_harness_prompt(settings.default_system_prompt, history_prompt)


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    from app.repositories.conversation_repository import list_conversations_for_user

    convs = await list_conversations_for_user(user, db)
    return [await _conversation_to_out(c, db) for c in convs]


@router.post("/conversations", response_model=ConversationOut)
async def create_conversation(
    payload: ConversationCreate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
):
    api_key = await _resolve_api_key(authorization, db)
    allowed = api_key.allowed_models if api_key else None
    if api_key:
        await quota_service.enforce_quota(db, api_key)
    model = select_model_for_new_conversation(payload.model, allowed_models=allowed)
    title = payload.title or "New chat"
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
async def update_conversation(conv_id: int, payload: ConversationUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv = await _get_conversation_or_404(conv_id, user, db)
    if payload.title is not None:
        conv.title = payload.title.strip() or conv.title
    if payload.model is not None:
        conv.model = payload.model
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
async def send_message(
    conv_id: int,
    payload: MessageCreate,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
):
    conv = await _get_conversation_or_404(conv_id, user, db)
    content = payload.content.strip()
    if not content:
        raise HTTPException(400, "Message content required")
    if len(content) > 20000:
        raise HTTPException(400, "Message too long (max 20000 chars)")

    api_key = await _resolve_api_key(authorization, db)
    allowed = api_key.allowed_models if api_key else None
    if api_key:
        await quota_service.enforce_quota(db, api_key)

    model = select_model_for_conversation(payload.model, conv.model, allowed_models=allowed)
    if model != conv.model:
        conv.model = model

    is_first = (await db.execute(select(Message).where(Message.conversation_id == conv.id).limit(1))).scalar_one_or_none() is None
    _maybe_update_title(conv, content, is_first)
    conv.updated_at = datetime.utcnow()

    user_msg = Message(conversation_id=conv.id, role="user", content=content)
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(conv)

    history = (await db.execute(select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at))).scalars().all()
    prompt = _history_to_prompt(history)

    harness_name, model_name = _validate_model_or_400(model)
    adapter = get_adapter(harness_name)

    # request_id for non-stream cancel support
    request_id = f"chat:{conv.id}:{uuid.uuid4().hex[:8]}"
    # Note: payload.stream is intentionally ignored here — streaming is served via /messages/stream
    started = time.monotonic()
    try:
        result_h = await adapter.run(prompt, model_name, request_id=request_id)
    except HTTPException:
        raise
    except RuntimeError as exc:
        logger.error("harness_error harness=%s model=%s error=%s", harness_name, model_name, str(exc))
        sanitized = _sanitize_harness_error(exc)
        status = 504 if "timed out" in str(exc).lower() or "timeout" in str(exc).lower() else 502
        err_text = f"⚠️ {sanitized}"
        err_msg = Message(conversation_id=conv.id, role="assistant", content=err_text)
        db.add(err_msg)
        conv.updated_at = datetime.utcnow()
        await db.commit()
        raise HTTPException(status_code=status, detail={"error": {"code": "harness_error", "message": sanitized}})

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
async def stream_message(
    conv_id: int,
    payload: MessageCreate,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
):
    conv = await _get_conversation_or_404(conv_id, user, db)
    content = payload.content.strip()
    if not content:
        raise HTTPException(400, "Message content required")
    if len(content) > 20000:
        raise HTTPException(400, "Message too long")

    api_key = await _resolve_api_key(authorization, db)
    allowed = api_key.allowed_models if api_key else None
    if api_key:
        await quota_service.enforce_quota(db, api_key)

    model = select_model_for_conversation(payload.model, conv.model, allowed_models=allowed)
    harness_name, model_name = _validate_model_or_400(model)
    adapter = get_adapter(harness_name)

    if model != conv.model:
        conv.model = model
    is_first = (await db.execute(select(Message).where(Message.conversation_id == conv.id).limit(1))).scalar_one_or_none() is None
    _maybe_update_title(conv, content, is_first)
    conv.updated_at = datetime.utcnow()
    user_msg = Message(conversation_id=conv.id, role="user", content=content)
    db.add(user_msg)
    await db.flush()
    await db.commit()

    history = (await db.execute(select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at))).scalars().all()
    prompt = _history_to_prompt(history)

    # request_id for cancel tracking
    request_id = f"chat:{conv.id}:{uuid.uuid4().hex[:8]}"

    async def event_stream():
        from app.db.database import SessionLocal
        from app.services.process_registry import process_registry

        collected: list[str] = []
        started = time.monotonic()
        cancelled = False
        try:
            async for text, metadata in adapter.stream(prompt, model_name, request_id=request_id):
                # auto-cancel on client disconnect
                if await request.is_disconnected():
                    logger.info("client_disconnected cancelling request_id=%s", request_id)
                    await process_registry.cancel(request_id)
                    cancelled = True
                    # yield cancel event for S2 (S4 will use proper event: cancel)
                    yield f"data: {json.dumps({'error': {'code': 'cancelled', 'message': 'cancelled by client'}})}\n\n"
                    break
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
                # also check disconnect after yield
                if await request.is_disconnected():
                    await process_registry.cancel(request_id)
                    cancelled = True
                    yield f"data: {json.dumps({'error': {'code': 'cancelled', 'message': 'cancelled by client'}})}\n\n"
                    break
            if cancelled:
                # do not emit DONE, do not persist success record
                return
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
        except RuntimeError as exc:
            # if we were cancelled, the process kill may surface as RuntimeError — treat as cancelled
            # exit code -9 (SIGKILL) / -15 (SIGTERM) indicates killed via cancel
            msg_lower = str(exc).lower()
            is_killed = "exit code -9" in msg_lower or "exit code -15" in msg_lower or "killed" in msg_lower
            if cancelled or "cancel" in msg_lower or is_killed:
                logger.info("stream_cancelled request_id=%s error=%s", request_id, str(exc))
                yield f"data: {json.dumps({'error': {'code': 'cancelled', 'message': 'cancelled'}})}\n\n"
                return
            logger.error("harness_stream_error harness=%s model=%s error=%s", harness_name, model, str(exc))
            sanitized = _sanitize_harness_error(exc)
            try:
                async with SessionLocal() as session:
                    err_text = f"⚠️ {sanitized}"
                    msg = Message(conversation_id=conv.id, role="assistant", content=err_text)
                    session.add(msg)
                    conv2 = await session.get(Conversation, conv.id)
                    if conv2:
                        conv2.updated_at = datetime.utcnow()
                    await session.commit()
            except Exception:
                # best-effort persistence after harness failure — never mask original harness error
                pass
            err = {"error": {"code": "harness_error", "message": sanitized, "type": "harness_error"}}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
            "X-Request-ID": request_id,
        },
    )


@router.post("/conversations/{conv_id}/cancel")
async def cancel_conversation_stream(conv_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    # verify ownership
    await _get_conversation_or_404(conv_id, user, db)
    from app.services.process_registry import process_registry

    # try prefix cancel (any in-flight for this conv)
    prefix = f"chat:{conv_id}:"
    # snapshot keys to avoid holding lock while iterating
    keys = list(process_registry._map.keys())
    target = None
    for k in keys:
        if k.startswith(prefix):
            target = k
            break
    if target:
        ok = await process_registry.cancel(target)
        if ok:
            return {"status": "cancelled", "request_id": target}
    raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "No in-flight stream for conversation"}})


@router.post("/conversations/{conv_id}/messages/{msg_id}/cancel")
async def cancel_message(conv_id: int, msg_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await _get_conversation_or_404(conv_id, user, db)
    from app.services.process_registry import process_registry

    # try exact match f"chat:{conv_id}:{msg_id}" then msg_id alone then prefix
    candidates = [f"chat:{conv_id}:{msg_id}", msg_id, f"chat:{msg_id}"]
    for cid in candidates:
        if cid in process_registry._map:
            ok = await process_registry.cancel(cid)
            if ok:
                return {"status": "cancelled", "request_id": cid}
    # fallback prefix search
    prefix = f"chat:{conv_id}:"
    keys = list(process_registry._map.keys())
    for k in keys:
        if k.startswith(prefix):
            ok = await process_registry.cancel(k)
            if ok:
                return {"status": "cancelled", "request_id": k}
    raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "No in-flight stream"}})
