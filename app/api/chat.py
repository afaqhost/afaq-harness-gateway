import asyncio
import json
import logging
import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
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
from app.services import credential_service, quota_service
from app.services.model_service import (
    select_model_for_conversation,
    select_model_for_new_conversation,
    validate_model_or_400,
)
try:
    from app.api.metrics import HARNESS_CALLS, HARNESS_LATENCY
except ImportError:
    HARNESS_CALLS = None
    HARNESS_LATENCY = None
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
    archived: bool | None = None


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
    archived: bool = False
    archived_at: datetime | None = None
    deleted_at: datetime | None = None
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
        archived=bool(conv.archived),
        archived_at=conv.archived_at,
        deleted_at=conv.deleted_at,
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
async def list_conversations(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=200),
    archived: bool = Query(default=False),
):
    from app.repositories.conversation_repository import list_conversations_for_user

    convs = await list_conversations_for_user(user, db, limit=limit, offset=offset, q=q, archived=archived)
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
async def get_conversation(
    conv_id: int,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    limit_messages: int = Query(default=100, ge=1, le=200),
    offset_messages: int = Query(default=0, ge=0),
):
    conv = await _get_conversation_or_404(conv_id, user, db)
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.created_at)
        .limit(limit_messages)
        .offset(offset_messages)
    )
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
    if payload.archived is not None:
        conv.archived = payload.archived
        conv.archived_at = datetime.utcnow() if payload.archived else None
    conv.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(conv)
    return await _conversation_to_out(conv, db)


@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(conv_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv = await _get_conversation_or_404(conv_id, user, db)
    # soft delete
    conv.deleted_at = datetime.utcnow()
    conv.archived = True
    conv.archived_at = conv.archived_at or datetime.utcnow()
    await db.commit()


@router.post("/conversations/{conv_id}/restore", response_model=ConversationOut)
async def restore_conversation(conv_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    # need to fetch even if soft-deleted, so bypass get_conversation_or_404's deleted check
    conv = await db.get(Conversation, conv_id)
    if not conv or conv.user_id != user.id:
        raise HTTPException(404, "Conversation not found")
    if conv.deleted_at is None:
        raise HTTPException(400, detail={"error": {"code": "not_deleted", "message": "Conversation is not deleted"}})
    conv.deleted_at = None
    # keep archived as is? Restore should unarchive as well? Per spec restore -> back to visible
    conv.archived = False
    conv.archived_at = None
    conv.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(conv)
    return await _conversation_to_out(conv, db)


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
    # credential env injection
    env = await credential_service.get_env_for_harness(db, user.id, harness_name)
    # Note: payload.stream is intentionally ignored here — streaming is served via /messages/stream
    started = time.monotonic()
    try:
        result_h = await adapter.run(prompt, model_name, request_id=request_id, env=env)
        # metrics
        if HARNESS_CALLS:
            try:
                HARNESS_CALLS.labels(harness=harness_name, model=model).inc()
                if HARNESS_LATENCY:
                    HARNESS_LATENCY.labels(harness=harness_name).observe(int((time.monotonic() - started) * 1000))
            except Exception:
                pass
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
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
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
    history_key = f"conv:{conv.id}"
    # credential env for harness
    stream_env = await credential_service.get_env_for_harness(db, user.id, harness_name)

    async def event_stream():
        from app.db.database import SessionLocal
        from app.services.process_registry import process_registry
        from app.shared.sse import sse_event

        collected: list[str] = []
        started = time.monotonic()
        cancelled = False
        seq = 1

        # helper to yield and store in history
        def _store_and_yield(event: str, data, id_val: int | None = None, retry: int | None = None) -> str:
            if retry is None:
                retry = settings.sse_retry_ms
            payload = sse_event(event, data, id=id_val, retry=retry)
            # store for reconnect (per conv)
            try:
                process_registry.append_history(history_key, id_val if id_val is not None else seq, payload)
            except Exception:
                pass
            return payload

        # replay from Last-Event-ID if provided
        if last_event_id is not None:
            try:
                last_id = int(last_event_id)
                replay = process_registry.get_replay(history_key, last_id)
                for rp in replay:
                    yield rp
                # set seq to max after replay
                hist = process_registry.get_history(history_key)
                if hist:
                    seq = max(s for s, _ in hist) + 1
                else:
                    seq = last_id + 1
            except ValueError:
                pass

        # lifecycle: start
        start_data = {"id": str(conv.id), "model": model, "created": int(time.time()), "request_id": request_id}
        yield _store_and_yield("start", start_data, id_val=seq, retry=settings.sse_retry_ms)
        seq += 1

        # heartbeat + token loop with configurable timeout (keep pending task alive)
        stream_iter = adapter.stream(prompt, model_name, request_id=request_id, env=stream_env).__aiter__()
        pending = None
        try:
            while True:
                if await request.is_disconnected():
                    logger.info("client_disconnected cancelling request_id=%s", request_id)
                    await process_registry.cancel(request_id)
                    cancelled = True
                    if pending:
                        pending.cancel()
                    yield _store_and_yield("cancel", {"code": "cancelled", "message": "cancelled by client"}, id_val=seq)
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
                    await process_registry.cancel(request_id)
                    cancelled = True
                    yield _store_and_yield("cancel", {"code": "cancelled", "message": "cancelled by client"}, id_val=seq)
                    break

                if not text:
                    continue
                collected.append(text)
                chunk = {
                    "id": str(conv.id),
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
                }
                yield _store_and_yield("token", chunk, id_val=seq, retry=settings.sse_retry_ms)
                seq += 1

            if cancelled:
                return
            if not collected:
                raise RuntimeError("Harness returned empty response — لا يوجد رد من الموديل. جرب موديل آخر مثل opencode/big-pickle")

            # usage before done
            full_text = "".join(collected)
            usage_data = {
                "prompt_tokens": len(prompt.split()),
                "completion_tokens": len(full_text.split()),
                "total_tokens": len(prompt.split()) + len(full_text.split()),
                "harness": harness_name,
                "model": model,
            }
            # metrics
            if HARNESS_CALLS:
                try:
                    HARNESS_CALLS.labels(harness=harness_name, model=model).inc()
                    if HARNESS_LATENCY:
                        HARNESS_LATENCY.labels(harness=harness_name).observe(int((time.monotonic() - started) * 1000))
                except Exception:
                    pass
            yield _store_and_yield("usage", usage_data, id_val=seq, retry=settings.sse_retry_ms)
            seq += 1

            # also show token done as event: done with [DONE]
            yield _store_and_yield("done", "[DONE]", id_val=seq, retry=settings.sse_retry_ms)
            seq += 1

            async with SessionLocal() as session:
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
            msg_lower = str(exc).lower()
            is_killed = "exit code -9" in msg_lower or "exit code -15" in msg_lower or "killed" in msg_lower
            if cancelled or "cancel" in msg_lower or is_killed:
                logger.info("stream_cancelled request_id=%s error=%s", request_id, str(exc))
                yield _store_and_yield("cancel", {"code": "cancelled", "message": "cancelled"}, id_val=seq)
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
                pass
            err = {"code": "harness_error", "message": sanitized, "type": "harness_error"}
            yield _store_and_yield("error", err, id_val=seq)

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
