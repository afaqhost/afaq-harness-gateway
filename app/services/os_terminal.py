"""OS Terminal service — owns POSIX PTY sessions for the dashboard /terminal page.

Same shape as CasaOS / VS Code / JupyterLab's terminal: spawn a login shell
under a real PTY, expose it over asyncio primitives so the WebSocket
endpoint in `app/api/os_terminal.py` can pump bytes both ways.

POSIX only (`pty.openpty`). Windows hosts refuse at API layer.
"""

from __future__ import annotations

import asyncio
import errno
import fcntl
import logging
import os
import pty
import signal
import struct
import termios
import time
import uuid
from dataclasses import dataclass, field
from typing import AsyncIterator

logger = logging.getLogger("afaq")


class TerminalError(Exception):
    """Raised when a PTY session cannot be started or operated on."""


@dataclass
class TerminalSession:
    terminal_id: str
    user_id: int
    fd: int
    pid: int
    shell: str
    cwd: str
    cols: int = 80
    rows: int = 24
    created_at: float = field(default_factory=time.monotonic)
    last_activity: float = field(default_factory=time.monotonic)
    _reader_task: asyncio.Task | None = field(default=None, init=False, repr=False)
    _stopped: bool = field(default=False, init=False, repr=False)
    _output_queue: asyncio.Queue[bytes | None] = field(
        default_factory=asyncio.Queue, init=False, repr=False
    )


class OsTerminalService:
    """Per-user terminal session registry + PTY plumbing.

    Lifecycle:
        await start(user_id, shell, cwd) -> TerminalSession
        await write(session_id, user_id, data)        # stdin
        await resize(session_id, user_id, cols, rows)
        async for chunk in stream(session_id, user_id): ...   # stdout
        await stop(session_id, user_id)

    Multi-user isolation: every public method requires (session_id, user_id)
    and raises TerminalError if the session doesn't belong to that user.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, TerminalSession] = {}
        self._lock = asyncio.Lock()

    # ---------- lifecycle ----------

    async def start(
        self,
        user_id: int,
        shell: str | None = None,
        cwd: str | None = None,
        cols: int = 80,
        rows: int = 24,
    ) -> TerminalSession:
        if not hasattr(os, "fork") or not hasattr(pty, "openpty"):
            raise TerminalError("OS terminal requires a POSIX host (pty.openpty not available).")

        shell = shell or os.environ.get("SHELL") or "/bin/bash"
        if not os.path.isabs(shell) and not os.path.isfile(shell) and not os.path.isdir(shell):
            # resolve via PATH
            from shutil import which

            resolved = which(shell)
            if not resolved:
                raise TerminalError(f"Shell not found: {shell}")
            shell = resolved
        if not os.path.isfile(shell):
            raise TerminalError(f"Shell not executable: {shell}")

        cwd = cwd or os.getcwd()
        if not os.path.isdir(cwd):
            raise TerminalError(f"CWD does not exist: {cwd}")

        cols = max(20, min(cols, 500))
        rows = max(5, min(rows, 200))

        # pty.fork creates the child + opens the PTY in one syscall; safer than
        # fork()+exec because the controlling-terminal setup is done in the
        # child before exec.
        pid, fd = pty.fork()
        if pid == 0:
            # Child: set up env, become session leader, exec shell.
            try:
                os.chdir(cwd)
            except OSError as exc:
                os.write(2, f"chdir failed: {exc}\n".encode())
                os._exit(126)
            try:
                os.environ["TERM"] = os.environ.get("TERM") or "xterm-256color"
                os.environ["AFAQ_TERMINAL"] = "1"
                os.environ["COLORTERM"] = os.environ.get("COLORTERM", "truecolor")
                # ensure the child is its own session leader so the PTY becomes
                # its controlling tty
                os.setsid()
                # best-effort: make the PTY its controlling tty
                try:
                    fcntl.ioctl(0, termios.TIOCSCTTY, 0)
                except OSError:
                    pass
                os.execvp(shell, [shell, "--login"])
            except OSError as exc:
                os.write(2, f"exec failed: {exc}\n".encode())
                os._exit(127)

        # Parent: set initial size, mark fd non-blocking, register.
        try:
            self._set_winsize(fd, rows, cols)
        except OSError as exc:
            logger.warning("terminal_winsize_failed fd=%s error=%s", fd, exc)

        try:
            flags = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        except OSError as exc:
            logger.warning("terminal_nonblock_failed fd=%s error=%s", fd, exc)

        terminal_id = uuid.uuid4().hex[:16]
        session = TerminalSession(
            terminal_id=terminal_id,
            user_id=user_id,
            fd=fd,
            pid=pid,
            shell=shell,
            cwd=cwd,
            cols=cols,
            rows=rows,
        )
        async with self._lock:
            self._sessions[terminal_id] = session
        session._reader_task = asyncio.create_task(self._read_loop(session), name=f"term-{terminal_id}")
        logger.info("terminal_started id=%s user_id=%s pid=%s shell=%s cwd=%s", terminal_id, user_id, pid, shell, cwd)
        return session

    async def stop(self, terminal_id: str, user_id: int | None = None) -> bool:
        async with self._lock:
            session = self._sessions.pop(terminal_id, None)
        if session is None:
            return False
        if user_id is not None and session.user_id != user_id:
            # put it back; reject the stop
            async with self._lock:
                self._sessions[terminal_id] = session
            raise TerminalError("Terminal does not belong to this user")
        await self._terminate(session)
        return True

    async def _terminate(self, session: TerminalSession) -> None:
        if session._stopped:
            return
        session._stopped = True
        # close the fd so the reader loop wakes from blocking read
        try:
            os.close(session.fd)
        except OSError:
            pass
        # signal the shell; escalate if it doesn't exit
        try:
            os.kill(session.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except OSError as exc:
            logger.warning("terminal_sigterm_failed pid=%s error=%s", session.pid, exc)

        async def _force_kill() -> None:
            await asyncio.sleep(2.0)
            try:
                os.kill(session.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except OSError as exc:
                logger.warning("terminal_sigkill_failed pid=%s error=%s", session.pid, exc)

        asyncio.create_task(_force_kill())

        if session._reader_task is not None and not session._reader_task.done():
            try:
                await asyncio.wait_for(session._reader_task, timeout=0.5)
            except asyncio.TimeoutError:
                session._reader_task.cancel()
        try:
            session._output_queue.put_nowait(None)  # sentinel for stream()
        except asyncio.QueueFull:
            pass

    async def _read_loop(self, session: TerminalSession) -> None:
        """Background task: copy PTY output bytes into the per-session queue."""
        loop = asyncio.get_running_loop()
        try:
            while not session._stopped:
                try:
                    chunk = await loop.run_in_executor(None, self._blocking_read, session)
                except OSError as exc:
                    if exc.errno in (errno.EIO, errno.EBADF):
                        # PTY closed (shell exited or fd was closed)
                        break
                    logger.debug("terminal_read_os_error fd=%s error=%s", session.fd, exc)
                    continue
                if not chunk:
                    # EOF: child closed its end
                    break
                session.last_activity = time.monotonic()
                try:
                    session._output_queue.put_nowait(chunk)
                except asyncio.QueueFull:
                    # drop oldest; the client is too slow
                    try:
                        session._output_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    try:
                        session._output_queue.put_nowait(chunk)
                    except asyncio.QueueFull:
                        logger.warning("terminal_queue_overrun id=%s", session.terminal_id)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("terminal_read_loop_crash id=%s", session.terminal_id)
        finally:
            try:
                session._output_queue.put_nowait(None)
            except asyncio.QueueFull:
                pass

    @staticmethod
    def _blocking_read(session: TerminalSession) -> bytes:
        """Run a blocking os.read on the PTY fd in a thread executor."""
        try:
            return os.read(session.fd, 4096)
        except OSError:
            return b""

    # ---------- stdin / stdout ----------

    async def write(self, terminal_id: str, user_id: int, data: bytes) -> int:
        session = self._require(terminal_id, user_id)
        if session._stopped:
            raise TerminalError("Terminal already stopped")
        try:
            written = os.write(session.fd, data)
        except OSError as exc:
            raise TerminalError(f"Write failed: {exc}") from exc
        session.last_activity = time.monotonic()
        return written

    async def resize(self, terminal_id: str, user_id: int, cols: int, rows: int) -> None:
        session = self._require(terminal_id, user_id)
        cols = max(20, min(cols, 500))
        rows = max(5, min(rows, 200))
        try:
            self._set_winsize(session.fd, rows, cols)
            os.kill(session.pid, signal.SIGWINCH)
        except OSError as exc:
            raise TerminalError(f"Resize failed: {exc}") from exc
        session.cols = cols
        session.rows = rows

    @staticmethod
    def _set_winsize(fd: int, rows: int, cols: int) -> None:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    async def stream(self, terminal_id: str, user_id: int) -> AsyncIterator[bytes]:
        """Yield PTY output chunks until the session ends."""
        session = self._require(terminal_id, user_id)
        while True:
            chunk = await session._output_queue.get()
            if chunk is None:
                break
            yield chunk
            if session._stopped:
                # drain any remaining bytes
                while True:
                    try:
                        extra = session._output_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                    if extra is None:
                        return
                    yield extra
                return

    # ---------- introspection ----------

    def get(self, terminal_id: str, user_id: int | None = None) -> TerminalSession | None:
        session = self._sessions.get(terminal_id)
        if session is None:
            return None
        if user_id is not None and session.user_id != user_id:
            return None
        return session

    def list_for_user(self, user_id: int) -> list[TerminalSession]:
        return [s for s in self._sessions.values() if s.user_id == user_id]

    def status(self, terminal_id: str, user_id: int) -> dict | None:
        session = self.get(terminal_id, user_id)
        if session is None:
            return None
        alive = self._pid_alive(session.pid)
        return {
            "alive": alive and not session._stopped,
            "cols": session.cols,
            "rows": session.rows,
            "cwd": session.cwd,
            "pid": session.pid,
            "shell": session.shell,
            "uptime_seconds": time.monotonic() - session.created_at,
            "idle_seconds": time.monotonic() - session.last_activity,
        }

    @staticmethod
    def _pid_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except OSError:
            return True  # EPERM means it exists but we can't signal
        return True

    # ---------- internal ----------

    def _require(self, terminal_id: str, user_id: int) -> TerminalSession:
        session = self._sessions.get(terminal_id)
        if session is None:
            raise TerminalError("Terminal not found")
        if session.user_id != user_id:
            raise TerminalError("Terminal does not belong to this user")
        return session

    async def shutdown(self) -> None:
        """Best-effort cleanup on app shutdown — used by lifespan."""
        async with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for s in sessions:
            try:
                await self._terminate(s)
            except Exception:
                pass


# singleton
os_terminal_service = OsTerminalService()
