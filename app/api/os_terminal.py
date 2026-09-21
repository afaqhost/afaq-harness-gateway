"""OS Terminal API — REST + WebSocket pump over a POSIX PTY.

Endpoints (all admin-only — opening a shell to the gateway host is a trusted op):

    POST /api/admin/terminal/start          -> {terminal_id, cols, rows, shell, cwd}
    POST /api/admin/terminal/{id}/stop      -> 204
    GET  /api/admin/terminal/{id}           -> {alive, cols, rows, cwd, pid, ...}
    WS   /api/admin/terminal/{id}/ws        -> bidirectional raw bytes

WebSocket frame format:
    client -> server  : text frame, raw bytes (UTF-8 with errors=replace on read).
                         Optional JSON `{"type":"resize","cols":..,"rows":..}` for resize.
    server -> client  : text frame, raw PTY output bytes (errors="replace").
                         `{"type":"exit","code":int}` when the shell exits.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.api.auth import admin_user
from app.core.config import settings
from app.db.database import User
from app.services.os_terminal import OsTerminalService, TerminalError, os_terminal_service

logger = logging.getLogger("afaq")

router = APIRouter()


class TerminalStartRequest(BaseModel):
    shell: str | None = Field(default=None, max_length=256)
    cwd: str | None = Field(default=None, max_length=512)
    cols: int = Field(default=80, ge=20, le=500)
    rows: int = Field(default=24, ge=5, le=200)


@router.post("/terminal/start")
async def terminal_start(
    payload: TerminalStartRequest | None = None,
    request: Request = None,  # type: ignore[assignment]
    user: User = Depends(admin_user),
):
    payload = payload or TerminalStartRequest()
    try:
        cwd = payload.cwd or str(settings.harness_data_dir)
        session = await os_terminal_service.start(
            user_id=user.id,
            shell=payload.shell,
            cwd=cwd,
            cols=payload.cols,
            rows=payload.rows,
        )
    except TerminalError as exc:
        logger.warning("terminal_start_failed user_id=%s error=%s", user.id, exc)
        raise HTTPException(
            status_code=503,
            detail={"error": {"code": "terminal_unavailable", "message": str(exc)}},
        ) from exc
    except OSError as exc:
        logger.warning("terminal_start_oserror user_id=%s error=%s", user.id, exc)
        raise HTTPException(
            status_code=503,
            detail={"error": {"code": "terminal_oserror", "message": str(exc)}},
        ) from exc
    return {
        "terminal_id": session.terminal_id,
        "pid": session.pid,
        "shell": session.shell,
        "cwd": session.cwd,
        "cols": session.cols,
        "rows": session.rows,
    }


@router.post("/terminal/{terminal_id}/stop", status_code=204)
async def terminal_stop(terminal_id: str, user: User = Depends(admin_user)):
    try:
        await os_terminal_service.stop(terminal_id, user_id=user.id)
    except TerminalError as exc:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": str(exc)}}) from exc
    return None


@router.get("/terminal/{terminal_id}")
async def terminal_status(terminal_id: str, user: User = Depends(admin_user)):
    status = os_terminal_service.status(terminal_id, user_id=user.id)
    if status is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "Terminal not found"}})
    return status


@router.websocket("/terminal/{terminal_id}/ws")
async def terminal_ws(websocket: WebSocket, terminal_id: str):
    """Bidirectional PTY pump over WebSocket.

    Auth: same `Authorization: Bearer <jwt>` header as the rest of the API.
    Browsers forward headers on the WS upgrade automatically (FastAPI exposes
    them on `websocket.headers`).
    """
    user = await _authenticate_ws(websocket)
    if user is None:
        await websocket.close(code=1008)  # policy violation
        return
    if not _is_admin(user):
        await websocket.close(code=1008)
        return

    session = os_terminal_service.get(terminal_id, user_id=user.id)
    if session is None:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    logger.info("terminal_ws_connected id=%s user_id=%s", terminal_id, user.id)

    # writer task: pump PTY output to client
    async def writer() -> None:
        try:
            async for chunk in os_terminal_service.stream(terminal_id, user.id):
                if chunk is None:
                    break
                # chunk is bytes from the PTY; send as text frame with replace
                await websocket.send_text(chunk.decode("utf-8", errors="replace"))
        except Exception:
            logger.debug("terminal_ws_writer_crash id=%s", terminal_id, exc_info=True)
        finally:
            # Surface the real exit code (0 = clean exit; non-zero = error).
            try:
                status = os_terminal_service.status(terminal_id, user.id)
                exit_code = status.get("exit_code") if status else None
                await websocket.send_json({"type": "exit", "code": exit_code if exit_code is not None else 0})
            except Exception:
                try:
                    await websocket.send_json({"type": "exit", "code": 0})
                except Exception:
                    pass

    writer_task = asyncio.create_task(writer())

    # reader: client -> stdin
    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            data = msg.get("text")
            if data is None:
                continue
            # resize messages are JSON; everything else is raw stdin
            if data.startswith("{"):
                try:
                    obj: Any = __import__("json").loads(data)
                except Exception:
                    obj = None
                if isinstance(obj, dict) and obj.get("type") == "resize":
                    cols = int(obj.get("cols", session.cols))
                    rows = int(obj.get("rows", session.rows))
                    try:
                        await os_terminal_service.resize(terminal_id, user.id, cols=cols, rows=rows)
                    except TerminalError:
                        pass
                    continue
            try:
                await os_terminal_service.write(terminal_id, user.id, data.encode("utf-8"))
            except TerminalError:
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("terminal_ws_reader_crash id=%s", terminal_id, exc_info=True)
    finally:
        writer_task.cancel()
        try:
            await writer_task
        except (asyncio.CancelledError, Exception):
            pass
        try:
            await os_terminal_service.stop(terminal_id, user_id=user.id)
        except TerminalError:
            pass
        logger.info("terminal_ws_disconnected id=%s user_id=%s", terminal_id, user.id)


async def _authenticate_ws(websocket: WebSocket) -> User | None:
    """Resolve a User from the WS Authorization header (Bearer <jwt>).

    Mirrors `app.api.auth.current_user` but reads from the WS scope instead
    of a FastAPI Depends, because FastAPI's WebSocket dependency-injection
    story is awkward and we don't want to import the full `get_db` session
    machinery into the WS path.
    """
    from jose import JWTError, jwt
    from sqlalchemy import select

    from app.db.database import APIKey, SessionLocal, User
    from app.core.security import hash_api_key

    auth = websocket.headers.get("authorization") or websocket.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    raw = auth.split(" ", 1)[1].strip()
    if not raw:
        return None
    # JWT first (3 dot-separated segments)
    if raw.count(".") == 2:
        try:
            payload = jwt.decode(raw, settings.secret_key, algorithms=["HS256"])
            uid = int(payload.get("sub"))
        except (JWTError, TypeError, ValueError):
            uid = None
        if uid:
            async with SessionLocal() as session:
                user = await session.get(User, uid)
                if user and user.is_active:
                    return user
    # API key fallback
    digest = hash_api_key(raw)
    async with SessionLocal() as session:
        key = (
            await session.execute(
                select(APIKey).where(APIKey.key_hash == digest, APIKey.is_active == True)
            )
        ).scalar_one_or_none()
        if not key:
            return None
        user = await session.get(User, key.user_id)
        if user and user.is_active:
            return user
    return None


def _is_admin(user: User) -> bool:
    return user.role == "admin"
