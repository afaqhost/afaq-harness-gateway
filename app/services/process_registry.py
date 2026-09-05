"""In-flight process registry — tracks harness subprocesses for cancel.

Leaf service: no DB dependency, in-memory only. Used by controllers and
client adapters to allow client-initiated cancel and auto-cancel on
disconnect. Keeps {request_id -> ProcessHandle} with async lock.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field


@dataclass
class ProcessHandle:
    pid: int
    process: asyncio.subprocess.Process
    harness: str
    model: str
    started_at: float = field(default_factory=time.monotonic)
    request_id: str = ""


class ProcessRegistry:
    def __init__(self) -> None:
        self._map: dict[str, ProcessHandle] = {}
        self._lock = asyncio.Lock()
        self._pending_cancel: set[str] = set()
        # history delegated to transport layer — auto-chooses Redis if available, else in-memory
        # lazy import to avoid circular
        try:
            from app.transport.history import get_history_store  # type: ignore

            self._history = get_history_store()  # type: ignore
        except Exception:
            self._history: dict[str, deque[tuple[int, str]]] = defaultdict(lambda: deque(maxlen=100))  # type: ignore

    async def register(self, request_id: str, handle: ProcessHandle) -> None:
        # if cancel was requested before register (race), kill immediately and don't store
        async with self._lock:
            if request_id in self._pending_cancel:
                self._pending_cancel.remove(request_id)
                # kill immediately in background
                try:
                    if handle.process.returncode is None:
                        handle.process.kill()
                except ProcessLookupError:
                    pass
                return
            self._map[request_id] = handle

    async def cancel(self, request_id: str) -> bool:
        async with self._lock:
            handle = self._map.pop(request_id, None)
            if not handle:
                # remember for race where register hasn't happened yet
                self._pending_cancel.add(request_id)
                return False
        proc = handle.process
        try:
            # proc may already be done
            if proc.returncode is None:
                proc.kill()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    try:
                        proc.terminate()
                        await asyncio.wait_for(proc.wait(), timeout=1.0)
                    except (ProcessLookupError, asyncio.TimeoutError):
                        pass
            else:
                # already exited, nothing to kill
                pass
        except ProcessLookupError:
            pass
        except Exception:
            # best-effort, never raise
            pass
        return True

    async def cleanup(self, request_id: str) -> None:
        async with self._lock:
            self._map.pop(request_id, None)

    async def get(self, request_id: str) -> ProcessHandle | None:
        async with self._lock:
            return self._map.get(request_id)

    async def contains(self, request_id: str) -> bool:
        async with self._lock:
            return request_id in self._map

    async def find_by_prefix(self, prefix: str) -> str | None:
        async with self._lock:
            for key in self._map:
                if key.startswith(prefix):
                    return key
            return None

    async def cancel_by_prefix(self, prefix: str) -> str | None:
        """Find first key with prefix and cancel it. Returns cancelled key or None."""
        # locate under lock, then delegate to cancel for kill semantics
        target = await self.find_by_prefix(prefix)
        if target is None:
            return None
        ok = await self.cancel(target)
        return target if ok else None

    def size(self) -> int:
        return len(self._map)

    def clear(self) -> None:
        # sync clear for tests (no lock needed in single-threaded test)
        self._map.clear()
        self._pending_cancel.clear()
        try:
            self._history.clear()  # type: ignore
        except Exception:
            pass

    def append_history(self, key: str, seq: int, payload: str) -> None:
        try:
            # new HistoryStore API
            self._history.append(key, seq, payload)  # type: ignore
        except AttributeError:
            # fallback dict api (old)
            self._history[key].append((seq, payload))  # type: ignore

    def get_replay(self, key: str, last_id: int) -> list[str]:
        try:
            return self._history.replay(key, last_id)  # type: ignore
        except AttributeError:
            dq = self._history.get(key)  # type: ignore
            if not dq:
                return []
            return [payload for seq, payload in dq if seq > last_id]

    def get_history(self, key: str) -> deque[tuple[int, str]]:
        try:
            return self._history.get_history(key)  # type: ignore
        except AttributeError:
            return self._history.get(key, deque())  # type: ignore

    # for test introspection
    @property
    def _map_snapshot(self) -> dict[str, ProcessHandle]:
        return dict(self._map)


# singleton
process_registry = ProcessRegistry()
