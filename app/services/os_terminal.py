"""OS Terminal service — owns POSIX PTY sessions for the dashboard /terminal page.

Same shape as CasaOS / VS Code / JupyterLab's terminal: spawn a login shell
under a real PTY, expose it over asyncio primitives so the WebSocket
endpoint in `app/api/os_terminal.py` can pump bytes both ways.

POSIX only (openpty + posix_spawn). Windows hosts refuse at API layer.
"""

from __future__ import annotations

import asyncio
import errno
import fcntl
import logging
import os
import signal
import struct
import sys
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
    exit_code: int | None = field(default=None, init=False, repr=False)
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
        if not hasattr(os, "posix_spawn") or not hasattr(os, "openpty"):
            raise TerminalError("OS terminal requires a POSIX host with posix_spawn and openpty.")

        # Resolve shell path. If the explicit path doesn't exist or isn't
        # executable, fall back to a known list of shells (bash, zsh, sh)
        # before declaring the terminal unavailable.
        explicit_shell = shell
        shell_candidates = []
        if explicit_shell:
            from shutil import which
            resolved = explicit_shell if os.path.isabs(explicit_shell) else (which(explicit_shell) or explicit_shell)
            if os.path.isfile(resolved):
                shell_candidates.append(resolved)
        # Common fallbacks — checked in order. /bin/sh is POSIX-mandatory
        # and almost always present.
        for fallback in ("/bin/bash", "/bin/zsh", "/bin/sh", "/usr/bin/bash", "/usr/bin/sh"):
            if fallback not in shell_candidates and os.path.isfile(fallback) and os.access(fallback, os.X_OK):
                shell_candidates.append(fallback)
        if not shell_candidates:
            raise TerminalError(
                f"No usable shell found (tried: {explicit_shell}, /bin/bash, /bin/zsh, /bin/sh). "
                "Set $SHELL or pass `shell` in the request."
            )
        primary_shell = shell_candidates[0]
        # Validate exec perms so we get a clear error instead of EPERM at exec time
        if not os.access(primary_shell, os.X_OK):
            raise TerminalError(
                f"Shell not executable: {primary_shell} (check filesystem mount options: noexec)."
            )

        cwd = cwd or os.getcwd()
        if not os.path.isdir(cwd):
            raise TerminalError(f"CWD does not exist: {cwd}")

        cols = max(20, min(cols, 500))
        rows = max(5, min(rows, 200))

        master_fd, slave_fd = os.openpty()
        try:
            file_actions = [
                (os.POSIX_SPAWN_DUP2, slave_fd, 0),
                (os.POSIX_SPAWN_DUP2, slave_fd, 1),
                (os.POSIX_SPAWN_DUP2, slave_fd, 2),
                (os.POSIX_SPAWN_CLOSE, master_fd),
                (os.POSIX_SPAWN_CLOSE, slave_fd),
            ]

            cmd = [
                sys.executable,
                "-m",
                "app.services.os_terminal_child",
                "--cwd",
                cwd,
                *shell_candidates,
            ]

            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            child_env = dict(os.environ)
            existing_pp = child_env.get("PYTHONPATH", "")
            child_env["PYTHONPATH"] = f"{project_root}:{existing_pp}" if existing_pp else project_root

            # Spawn child wrapper module via posix_spawn; setsid where supported
            try:
                pid = os.posix_spawn(
                    sys.executable,
                    cmd,
                    child_env,
                    file_actions=file_actions,
                    setsid=True,
                )
            except (TypeError, ValueError, NotImplementedError):
                pid = os.posix_spawn(
                    sys.executable,
                    cmd,
                    child_env,
                    file_actions=file_actions,
                )
        except Exception:
            try:
                os.close(master_fd)
            except OSError:
                pass
            raise
        finally:
            try:
                os.close(slave_fd)
            except OSError:
                pass

        # Set initial size on master fd
        try:
            self._set_winsize(master_fd, rows, cols)
        except OSError as exc:
            logger.warning("terminal_winsize_failed fd=%s error=%s", master_fd, exc)

        terminal_id = uuid.uuid4().hex[:16]
        session = TerminalSession(
            terminal_id=terminal_id,
            user_id=user_id,
            fd=master_fd,
            pid=pid,
            shell=primary_shell,
            cwd=cwd,
            cols=cols,
            rows=rows,
        )
        async with self._lock:
            self._sessions[terminal_id] = session
        session._reader_task = asyncio.create_task(self._read_loop(session), name=f"term-{terminal_id}")
        logger.info("terminal_started id=%s user_id=%s pid=%s shell=%s cwd=%s", terminal_id, user_id, pid, primary_shell, cwd)
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
        # close the master fd so the reader loop wakes from blocking read
        try:
            os.close(session.fd)
        except OSError:
            pass

        # signal the shell and its process group (SIGHUP triggers clean hangup)
        for sig in (signal.SIGHUP, signal.SIGTERM):
            try:
                os.kill(session.pid, sig)
            except (ProcessLookupError, OSError):
                pass
            try:
                os.killpg(session.pid, sig)
            except (ProcessLookupError, OSError):
                pass

        # Check if already exited
        try:
            wpid, status = os.waitpid(session.pid, os.WNOHANG)
            if wpid == session.pid:
                session.exit_code = self._decode_status(status)
        except (ChildProcessError, OSError):
            pass

        # Bounded graceful wait
        if session.exit_code is None and self._pid_alive(session.pid):
            for _ in range(8):
                await asyncio.sleep(0.05)
                try:
                    wpid, status = os.waitpid(session.pid, os.WNOHANG)
                    if wpid == session.pid:
                        session.exit_code = self._decode_status(status)
                        break
                except (ChildProcessError, OSError):
                    break

        # Force kill if still running and reap
        if session.exit_code is None and self._pid_alive(session.pid):
            try:
                os.kill(session.pid, signal.SIGKILL)
            except (ProcessLookupError, OSError):
                pass
            try:
                os.killpg(session.pid, signal.SIGKILL)
            except (ProcessLookupError, OSError):
                pass
            for _ in range(8):
                try:
                    wpid, status = os.waitpid(session.pid, os.WNOHANG)
                    if wpid == session.pid:
                        session.exit_code = self._decode_status(status)
                        break
                except (ChildProcessError, OSError):
                    break
                await asyncio.sleep(0.05)

        # Cancel reader task and await completion
        if session._reader_task is not None and not session._reader_task.done():
            session._reader_task.cancel()
            try:
                await session._reader_task
            except asyncio.CancelledError:
                pass

        logger.info("terminal_exit id=%s pid=%s exit_code=%s", session.terminal_id, session.pid, session.exit_code)
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
        """Run a read on the PTY fd in a thread executor with select timeout so threads don't hang on stop."""
        import select
        while not session._stopped:
            try:
                r, _, _ = select.select([session.fd], [], [], 0.4)
            except (OSError, ValueError):
                return b""
            if r:
                try:
                    return os.read(session.fd, 4096)
                except OSError:
                    return b""
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
        # If the child has exited but we haven't observed it yet, try to reap.
        if not alive and session.exit_code is None:
            try:
                wpid, status = os.waitpid(session.pid, os.WNOHANG)
                if wpid == session.pid:
                    session.exit_code = self._decode_status(status)
            except (ChildProcessError, OSError):
                pass
        return {
            "alive": alive and not session._stopped,
            "exit_code": session.exit_code,
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

    @staticmethod
    def _decode_status(status: int) -> int:
        """Decode a waitpid status into a meaningful exit code.

        Returns the negative signal number if the child was killed by a
        signal (matches POSIX shell convention: 128 + signal), or the
        regular exit code otherwise.
        """
        try:
            import os as _os
            if _os.WIFSIGNALED(status):
                return -_os.WTERMSIG(status)
            if _os.WIFEXITED(status):
                return _os.WEXITSTATUS(status)
        except (AttributeError, OSError):
            pass
        return status

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
