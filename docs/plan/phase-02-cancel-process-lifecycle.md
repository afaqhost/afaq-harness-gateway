# Phase 02 — Cancel & Process Lifecycle

**Session ID:** `S2` · **Effort:** 3h · **Risk:** Critical · **Depends:** S1  
**Goal:** Client can abort generation; server kills the harness subprocess within 2s; no orphan 600s processes.

---

## 1. Why

`AFQAUDIT.md:166` flags *process cleanup on cancel → missing, client abort leaves subprocess 600s*. `app/clients/base.py:62` `create_subprocess_exec` is never killed on `request.is_disconnected()`. `app/api/chat.py:259` `event_stream` and `app/api/openai.py:116` `event_stream` have no `cancel` path. Mobile clients need `Stop` button (`DESIGN.md:499`).

**Files:**

- `app/clients/base.py:58` `run` / `app/clients/base.py:88` `stream` (process creation)
- `app/api/chat.py:233` `stream_message` (uses `SessionLocal` background)
- `app/api/openai.py:112` `_stream_response` (uses same `db` session)
- `app/services/model_service.py` (no change, but model validation must happen before register)

---

## 2. Scope

**IN:** In-flight registry, `POST /cancel` endpoints, auto-cancel on disconnect, 2s kill guarantee.  
**OUT:** Stream resumption/replay (S4), per-harness concurrency limits.

---

## 3. Architecture After

```
POST /messages/stream -> register(pid, request_id) -> adapter.stream -> yield token
       |                         |
       +-- client disconnect ------> request.is_disconnected() poll -> cancel(pid)
       +-- POST /cancel ----------> registry.cancel(request_id) -> process.kill() -> 204
```

New: `app/services/process_registry.py` (`{request_id: ProcessHandle}`).

Dependency: `controllers -> process_registry` (in-memory singleton). `clients/base.py` registers on `create_subprocess_exec`.

---

## 4. Detailed Tasks

### 4.1 S2.1 — Process Registry (`45m`)

- [ ] Create `app/services/process_registry.py`:

```python
import asyncio
from dataclasses import dataclass

@dataclass
class ProcessHandle:
    pid: int
    process: asyncio.subprocess.Process
    harness: str
    model: str
    started_at: float

class ProcessRegistry:
    def __init__(self): self._map: dict[str, ProcessHandle] = {}; self._lock = asyncio.Lock()
    async def register(self, request_id: str, handle: ProcessHandle): async with self._lock: self._map[request_id] = handle
    async def cancel(self, request_id: str) -> bool:
        async with self._lock: handle = self._map.pop(request_id, None)
        if not handle: return False
        try: handle.process.kill(); await asyncio.wait_for(handle.process.wait(), timeout=2)
        except ProcessLookupError: pass
        except asyncio.TimeoutError: handle.process.terminate()
        return True
    async def cleanup(self, request_id: str): async with self._lock: self._map.pop(request_id, None)
```

- [ ] Singleton `process_registry = ProcessRegistry()` exported.

### 4.2 S2.2 — Instrument `HarnessAdapter` (`45m`)

- [ ] In `app/clients/base.py:62` after `process = await create_subprocess_exec(...)`, call `await process_registry.register(request_id, ProcessHandle(...))` where `request_id` is passed via `stream(prompt, model, session_id, env, request_id=None)` new param (default `None` for BC). Add `request_id: str | None` to `run` and `stream` signatures `app/clients/base.py:58,88` and `app/domain/harness.py:23` `HarnessPort`.
- [ ] In `finally` of `run`/`stream`, `await registry.cleanup(request_id)` if `request_id`.
- [ ] For `run` (non-stream), registry still tracks for `POST /cancel` race (register before `communicate`, cleanup after).

### 4.3 S2.3 — Cancel Endpoints (`45m`)

- [ ] Add in `app/api/chat.py`:

```python
@router.post("/conversations/{conv_id}/messages/{msg_id}/cancel")
async def cancel_message(conv_id: int, msg_id: int, user: User = Depends(current_user)):
    # msg_id is request_id or message id that maps to request_id
    ok = await process_registry.cancel(f"chat:{conv_id}:{msg_id}")
    if not ok: raise HTTPException(404, "No in-flight stream")
    return {"status":"cancelled"}
```

Similarly `app/api/openai.py`:

```python
@router.post("/chat/completions/{completion_id}/cancel")
async def cancel_completion(completion_id: str, ...):
    ok = await process_registry.cancel(completion_id)
    ...
```

Simplify: Use `completion_id` `app/api/openai.py:67` `_completion_id` as `request_id`. For chat stream, use `f"{conv.id}:{int(time.time()*1000)}"` generated at `stream_message` entry.

- [ ] Return `204` or `{"status":"cancelled"}` + `event: cancel` SSE terminator.

### 4.4 S2.4 — Auto-Cancel on Disconnect (`45m`)

- [ ] In `app/api/chat.py:265` `async for text, metadata in adapter.stream(...)`, add per-iteration:

```python
if await request.is_disconnected():
    await process_registry.cancel(request_id)
    break
```

Need `request: Request` param in `stream_message` `app/api/chat.py:233` (`def stream_message(..., request: Request)`). FastAPI injects it.

- [ ] Same for `app/api/openai.py:116` `event_stream` — add `request: Request` to `chat_completions` and thread to `_stream_response`.

### 4.5 S2.5 — Client Stop Button

- [ ] `app/static/app.js` already has `Stop` `DESIGN.md:499` placeholder — wire to `fetch(..., {signal: AbortController})` + `POST /cancel` on `Abort`.

---

## 5. DB / Config Changes

- None. `settings.harness_timeout_seconds` already `90` cap `app/clients/base.py:64` stays. Only new `process_registry` in-memory.

---

## 6. Tests

**Unit** `tests/unit/test_process_registry.py`:

- `test_register_and_cancel_kills_process` (use dummy `asyncio.subprocess.Process` mock with `kill` flag)
- `test_cancel_unknown_returns_false`
- `test_cleanup_removes_entry`

**Integration** `tests/integration/test_cancel_integration.py` (real `test_engine`):

```python
async def test_stream_cancel_kills_process(client, user_headers):
    # FakeAdapter that streams slowly (sleep 5 per chunk)
    class SlowAdapter(FakeAdapter):
        async def stream(self, *a, **kw): await asyncio.sleep(5); yield "slow", {}
    with patch("app.api.chat.get_adapter", return_value=SlowAdapter()):
        # start stream in background task
        task = asyncio.create_task(client.post(f"/api/chat/conversations/{cid}/messages/stream", ...))
        await asyncio.sleep(0.2)
        cancel = await client.post(f"/api/chat/conversations/{cid}/messages/{mid}/cancel", headers=user_headers)
        assert cancel.status_code == 200
        # assert process killed within 2s (check registry empty)
```

Need to expose `process_registry._map` for assertion (test-only).

**e2e** `tests/e2e/test_cancel_e2e.py` — start stream, `client.is_disconnected` mock, assert DB does not get orphan `UsageRecord` with huge `latency_ms`.

Run:

```bash
.venv/bin/python -m pytest tests/unit/test_process_registry.py -q
.venv/bin/python -m pytest tests/integration/test_cancel_integration.py -q
```

---

## 7. Verification & Exit

- [ ] Start `POST /messages/stream` with `sleep 10` fake harness, hit `POST /cancel` within 0.5s → process `returncode` not `None` within 2s, SSE ends with `event: cancel` not `[DONE]`.
- [ ] Close browser tab mid-stream → server logs `cancel` and no process left `ps aux | grep opencode` empty.
- [ ] `pytest -m integration -q` includes cancel tests, total ~102 tests.

**Checklist:**

- [ ] `- [x] S2 Cancel & Lifecycle`

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| `request.is_disconnected()` polling overhead | Poll only per token (not busy loop); 15s heartbeat interval already in S4. |
| Race `cancel` after `stream` finished | `registry.cancel` returns `False` → `404`, idempotent. |
| Windows `kill` vs `terminate` | Keep `ProcessLookupError` + `terminate` fallback `app/clients/base.py:71`. |

**Rollback:** Remove `process_registry` calls, endpoints return `501 Not Implemented` — no schema change.

