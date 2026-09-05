# Phase 04 — SSE Completeness (IDs, Heartbeats, Reconnect)

**Session ID:** `S4` · **Effort:** 3h · **Risk:** High · **Depends:** S2  
**Goal:** Mobile can survive proxy drops and reconnect via `Last-Event-ID`; lifecycle events visible.

---

## 1. Why

`AFQAUDIT.md:212` SSE works but `212` flags *no `event:` / `id:` / `retry:` / heartbeats / reconnect*. `app/api/chat.py:259` and `app/api/openai.py:116` emit only `data: {...}\n\n` and final `data: [DONE]`. Proxies close idle streams, mobile loses context.

**Files:**

- `app/api/chat.py:259` `event_stream` (chat)
- `app/api/openai.py:112` `_stream_response` (openai)
- `app/static/app.js` (client EventSource, if any)

---

## 2. Scope

**IN:** `event:`/`id:`/`retry:` per SSE spec, `: keepalive` every 15s, `Last-Event-ID` replay, `start`/`usage` lifecycle events.  
**OUT:** Stream resumption via DB persistence beyond in-memory LRU (S8).

---

## 3. Architecture After

```
: keepalive\n\n           (every 15s)
id: 42\nevent: token\ndata: {"choices":[{"delta":{"content":"hi"}}]}\n\n
id: 43\nevent: tool_call\ndata: ...\n\n
id: 44\nevent: usage\ndata: {"prompt_tokens":...}\n\n
event: done\ndata: [DONE]\n\n
retry: 3000\n\n
```

Server keeps `deque[Event]` per `request_id` (S2 registry) size 100. On `GET .../stream` with `Last-Event-ID: 42`, replay from `43`.

---

## 4. Detailed Tasks

### 4.1 S4.1 — Event Envelope (`45m`)

- [ ] Create helper `app/shared/sse.py`:

```python
def sse_event(event: str, data: dict | str, id: int | None = None, retry: int | None = None) -> str:
    lines = []
    if id is not None: lines.append(f"id: {id}")
    if event: lines.append(f"event: {event}")
    if retry: lines.append(f"retry: {retry}")
    payload = json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else data
    for chunk in payload.splitlines():
        lines.append(f"data: {chunk}")
    lines.append(""); lines.append("")
    return "\n".join(lines)
```

- [ ] Replace in `app/api/chat.py:276` `yield f"data: {json.dumps(chunk)}\n\n"` → `yield sse_event("token", chunk, id=seq, retry=3000)` where `seq` increments per token. Similarly `final` → `event: done`, error → `event: error`, usage → `event: usage`.
- [ ] Same for `app/api/openai.py:120`.

### 4.2 S4.2 — Heartbeats (`30m`)

- [ ] In `app/api/chat.py:265` `async for text, metadata in adapter.stream(...)`, the `wait_for` timeout in `app/clients/base.py:99` is `cur_timeout=90` — too long for heartbeat. Change stream loop to use `asyncio.wait_for(..., timeout=15)` and on `TimeoutError` yield `: keepalive\n\n` and continue (not error) while process still alive. Or keep 90 for error but add separate heartbeat task:

```python
async def heartbeat():
    while True:
        await asyncio.sleep(15)
        yield ": keepalive\n\n"
```

Simpler: In `event_stream`, wrap `adapter.stream` with `async for` + `asyncio.wait` to emit heartbeat when no token for 15s.

- [ ] Ensure `X-Accel-Buffering: no` already `app/api/chat.py:327` stays.

### 4.3 S4.3 — Reconnect (`45m`)

- [ ] Accept `last_event_id: str | None = Header(default=None, alias="Last-Event-ID")` in `stream_message` `app/api/chat.py:233` and `chat_completions` `app/api/openai.py:88`.
- [ ] Store per `request_id` LRU: `app/services/process_registry.py` already has `request_id` map — extend to `events: deque[tuple[int, str]]` (id, sse payload). On `register`, init deque. On each `sse_event` yield, `deque.append((id, payload))`.
- [ ] On request with `Last-Event-ID`, parse `int(last_event_id)` and replay `deque` entries `> last_event_id` before live stream.

### 4.4 S4.4 — Lifecycle Events (`45m`)

- [ ] On stream start, before `async for`, yield `event: start` with `{"id": completion_id, "model": model, "created": int(time.time())}`.
- [ ] Before `event: done`, yield `event: usage` with `{"prompt_tokens":..., "completion_tokens":..., "total_tokens":...}` computed from `prompt` + `collected`.
- [ ] Document in `docs/api.md` new event types.

### 4.5 S4.5 — Client

- [ ] `app/static/app.js` change `new EventSource(url)` or manual `fetch` `text/event-stream` parser to handle `event:` dispatch. For `fetch`, parse `event:` lines and switch.

---

## 5. DB Changes

- None. In-memory LRU per `request_id`. For persistence beyond process restart, future `S8` can store `Message` as event log.

---

## 6. Tests

**Contract** `tests/contract/test_sse_contract.py` (new):

- `test_sse_emits_event_and_id` — mock `FakeAdapter.stream` 2 tokens, assert response text contains `event: token`, `id: 1`, `id: 2`, `event: done`, `[DONE]`.
- `test_sse_error_uses_event_error` — fake adapter raises `RuntimeError`, assert `event: error`.

**Integration** `tests/integration/test_sse_reconnect.py`:

```python
async def test_reconnect_replays_from_last_id(client, user_headers):
    # seed cache, create conv, start stream that yields 3 tokens via FakeAdapter
    # first stream: collect ids 1,2,3
    # second request with Last-Event-ID: 2 should replay token 3 before live
```

**Performance** `tests/performance/test_heartbeat.py`:

- Mock slow adapter that sleeps 20s without output, assert `: keepalive` appears in `stream.text` count >=1.

Run:

```bash
.venv/bin/python -m pytest tests/contract/test_sse_contract.py -q
.venv/bin/python -m pytest tests/integration/test_sse_reconnect.py -q
```

---

## 7. Verification & Exit

- [ ] `curl -N -H "Accept: text/event-stream" http://127.0.0.1:3500/api/chat/conversations/1/messages/stream -d '{"content":"hi"}'` shows `event: token` + `id:` + `: keepalive` after 15s.
- [ ] Kill network at token 2, reconnect with `curl -H "Last-Event-ID: 2"` → resumes at 3.
- [ ] `OkHttp EventSource` (Android) receives `retry: 3000` and auto-reconnects.
- [ ] `pytest -m contract -q` green; total ~100 tests.

**Checklist:**

- [ ] `- [x] S4 SSE Completeness`

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Large payload splits across `data:` lines | `sse_event` loops `payload.splitlines()` per spec — handle. |
| `Last-Event-ID` replay OOM | Cap deque `maxlen=100`, LRU per `request_id`, cleanup on `done`/`cancel`. |
| Heartbeat interferes with `adapter.stream` timeout 90s | Use 15s heartbeat loop separate from adapter 90s error timeout; heartbeat does not kill process. |

**Rollback:** Keep `event: token` but still accept old `data:`-only clients (they ignore `event:`). Safe.

