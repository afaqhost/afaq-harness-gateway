import json
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import current_user
from app.core.config import settings
from app.db.database import Conversation, Message, UsageRecord, User, get_db
from app.harnesses.registry import get_adapter
from app.repositories.conversation_repository import (
    fetch_conversation_summary,
    get_conversation_or_404 as repo_get_conversation_or_404,
)
from app.services.model_service import (
    select_model_for_conversation,
    select_model_for_new_conversation,
    validate_model_or_400,
)
from app.shared.model_utils import preview_text as _preview
from app.shared.prompt_utils import build_harness_prompt, build_history_prompt

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
async def create_conversation(payload: ConversationCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    model = select_model_for_new_conversation(payload.model)
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
async def send_message(conv_id: int, payload: MessageCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv = await _get_conversation_or_404(conv_id, user, db)
    content = payload.content.strip()
    if not content:
        raise HTTPException(400, "Message content required")
    if len(content) > 20000:
        raise HTTPException(400, "Message too long (max 20000 chars)")

    model = select_model_for_conversation(payload.model, conv.model)
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

    # Note: payload.stream is intentionally ignored here — streaming is served via /messages/stream
    started = time.monotonic()
    try:
        result_h = await adapter.run(prompt, model_name)
    except HTTPException:
        raise
    except RuntimeError as exc:
        msg = str(exc)
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
async def stream_message(conv_id: int, payload: MessageCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv = await _get_conversation_or_404(conv_id, user, db)
    content = payload.content.strip()
    if not content:
        raise HTTPException(400, "Message content required")
    if len(content) > 20000:
        raise HTTPException(400, "Message too long")

    model = select_model_for_conversation(payload.model, conv.model)
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

    async def event_stream():
        from app.db.database import SessionLocal

        collected: list[str] = []
        started = time.monotonic()
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
                # best-effort persistence after harness failure — never mask original harness error
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
