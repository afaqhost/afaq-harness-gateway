# Implementation Plan — Afaq Harness Gateway (Multi-Session)

> **Language:** English (per request)  
> **Scope:** All critical production gaps from `AFQAUDIT.md` **except image/file upload** (`docs/configuration.md:18` `uploads_dir` stays unused for now — explicitly excluded).  
> **Baseline:** After `aa95dd8` refactoring — `96 tests` passing (`tests/conftest.py:16` in-memory SQLite, `pytest.ini:2` `asyncio_mode=auto`), layered architecture `controllers/services/repositories/clients/models/shared/config`.

> **Split into phase files for multi-session continuation:** See `plan/README.md` for index, or jump directly to:
> - `plan/phase-01-security-rate-limiting.md` — S1 (3h)
> - `plan/phase-02-cancel-process-lifecycle.md` — S2 (3h)
> - `plan/phase-03-usage-pagination-archive.md` — S3 (3h)
> - `plan/phase-04-sse-completeness.md` — S4 (3h)
> - `plan/phase-05-harness-lifecycle-health.md` — S5 (3h)
> - `plan/phase-06-credential-profiles.md` — S6 (3h)
> - `plan/phase-07-tool-calling-structured-output.md` — S7 (4h)
> - `plan/phase-08-polish-observability.md` — S8 (3h)
> Details were split into `docs/plan/phase-*.md` per request — each file is ~170–230 lines, maximally detailed. This file remains the single-page overview.

This plan is designed to be resumed across sessions. Each session is self-contained (2–4h), has clear entry/exit criteria, and ends with `pytest -q` green.

---

## 0. Principles & How to Resume

- **One session = one mergeable increment.** Follow `code-refactorer` safe moves: *extract → delegate → verify → delete*. Commit per move with `type(scope):` prefix.
- **Behavior preserved unless explicitly stated.** New endpoints return `501` or `400` before implementation — never silent fallback.
- **Tests first per session:** Write contract/integration tests for new endpoint, see red, implement, see green. Mock only at boundaries (`HarnessAdapter`, `create_subprocess_exec`, `SessionLocal`).
- **Resume checklist:** Open this file, find first unchecked `- [ ]` box, run its session tasks in order. Last session's exit criteria is next session's entry gate.

**Current branch:** `main` at `aa95dd8`. Base verification after every session:

```bash
.venv/bin/python -m compileall -q app
.venv/bin/python -m pytest -q            # expect 96 + new tests
.venv/bin/python -m pytest -m unit -q
.venv/bin/python -m pytest -m integration -q
.venv/bin/python -m pytest -m e2e -q
.venv/bin/python -m pytest -m security -q
.venv/bin/python -m pytest -m performance -q
```

---

## 1. Session Map (8 Sessions, Image Upload Excluded)

| Session | Title | Primary Files | Risk | Effort | Depends |
|---|---|---|---|---|---|
| **S1** | Security Hardening & Rate Limiting | `app/main.py:22`, `app/db/database.py:33`, `app/api/openai.py:47`, `app/core/config.py:14`, `docker-compose.yml:14` | High | 3h | — |
| **S2** | Cancel & Process Lifecycle | `app/clients/base.py:58`, `app/api/chat.py:233`, `app/api/openai.py:112` | Critical | 3h | S1 |
| **S3** | Usage History, Pagination, Archive | `app/db/database.py:53`, `app/api/chat.py:104`, `app/repositories/conversation_repository.py` | Medium | 3h | — |
| **S4** | SSE Completeness (IDs, Heartbeats, Reconnect) | `app/api/chat.py:259`, `app/api/openai.py:116` | High | 3h | S2 |
| **S5** | Harness Lifecycle & Health | `app/api/admin.py:41`, `app/clients/registry.py`, `app/db/database.py:40` | Medium | 3h | S1 |
| **S6** | Credential Profiles (encrypt_secret wiring) | `app/core/security.py:34`, `app/db/database.py:40`, new `app/api/credentials.py` | Medium | 3h | S5 |
| **S7** | Tool Calling & Structured Output | `app/api/openai.py:27`, `app/clients/*.py: parse_line`, new `app/services/tool_service.py` | High | 4h | S4 |
| **S8** | Polish: Key Rotation, Error Standardization, Observability | `app/api/admin.py:58`, `app/main.py:22`, new `app/middleware/` | Low | 3h | S1–S7 |

> **Explicitly OUT of scope for this plan:** File upload/image input, MIME validation, `storage/uploads` lifecycle, `POST /files`, `GET /files/{id}`. `uploads_dir` `app/core/config.py:19` stays untracked until a future plan.

---

## 2. Detailed Sessions

### S1 — Security Hardening & Rate Limiting (Do First)

**Goal:** Close abuse vectors: unenforced limits, wildcard CORS, default secrets, docker.sock.

**Entry:** `96 tests` green on `main`.

**Tasks:**

- [ ] **S1.1 Rate limiting middleware** — Add `app/middleware/rate_limit.py` (in-memory token bucket for tests, Redis interface stub via `RateLimiter` Protocol). Wire in `app/main.py:22` `app.add_middleware(RateLimitMiddleware)`. Enforce `APIKey.daily_limit/monthly_limit` `app/db/database.py:33-34` in `app/api/openai.py:47` `resolve_identity` and `app/api/chat.py:155` `send_message` (check `UsageRecord` count `where created_at > today`). Return `429 {detail, retry_after}`.
- [ ] **S1.2 Enforce `allowed_models`** — In `app/services/model_service.py:45` `validate_model_or_400`, check `APIKey.allowed_models` when `key_id` present. Add helper `is_model_allowed(full_model, allowed_models) -> bool` with tests. Plumb `key_id` through `select_model_for_conversation` (new param `allowed_models`).
- [ ] **S1.3 Secrets & CORS** — Change `app/core/config.py:14-15` defaults to `""` and fail fast on startup if `SECRET_KEY`/`CREDENTIALS_KEY` still `change-me` when `debug==False`. Change `app/core/config.py:20` `allowed_origins` default from `"*"` to `"http://127.0.0.1:3500,http://localhost:3500"`; document override in `docs/configuration.md`.
- [ ] **S1.4 Docker hardening** — Remove `volumes: [/var/run/docker.sock:/var/run/docker.sock]` `docker-compose.yml:14`; add comment explaining production alternative (Docker API via TCP+TLS or build-only image). Keep volume for `data`/`storage` only.
- [ ] **S1.5 Error sanitization** — In `app/api/chat.py:192` and `app/api/openai.py:161`, stop returning `str(exc)` verbatim (leaks `stderr` paths). Map to sanitized `HarnessError(code, retryable=False)` with `detail` whitelist. Add `tests/security/test_rate_limit.py` and `tests/security/test_allowed_models.py`.

**Tests to add:**

- `tests/unit/test_rate_limiter.py` — bucket refill, burst, window rollover (parametrized, no mocks).
- `tests/integration/test_rate_limit_integration.py` — real DB, 5 sequential `POST /v1/chat/completions` with `daily_limit=5` then 6th expects `429`.
- `tests/security/test_security.py` — extend: tampered JWT still `401`, `allowed_models` violation `403`, `daily_limit` exceeded `429` (use `FakeAdapter`).

**Exit criteria:** `429` enforced, `allowed_models` blocks `403`, `docker-compose.yml` no sock, `pytest -m security -q` + `pytest -m integration -q` green. New tests ~12.

**Effort:** 3h (1h middleware + 1h allowed_models + 1h config/docker + tests).

---

### S2 — Cancel & Process Lifecycle (Critical for Mobile)

**Goal:** Client can abort stream; server kills subprocess within 2s; no orphan 600s.

**Tasks:**

- [ ] **S2.1 Track in-flight processes** — Add `app/services/process_registry.py` (`{request_id -> ProcessHandle}`) with `register`, `cancel`, `cleanup` (weakref, `asyncio.Lock`). Store `process.pid` from `app/clients/base.py:62` `create_subprocess_exec`.
- [ ] **S2.2 Cancel endpoint** — `POST /api/chat/conversations/{id}/messages/{msg_id}/cancel` and `POST /v1/chat/completions/{id}/cancel` (or `DELETE /v1/streams/{id}`) that calls `process.kill()` + `await process.wait()` with 2s timeout, returns `204`. Also handle client disconnect (`request.is_disconnected()` in `app/api/chat.py:259` `event_stream`) to auto-cancel.
- [ ] **S2.3 Timeout cap already done** `app/clients/base.py:64` `min(600,90)` — keep 90s cap, but ensure `asyncio.wait_for` TimeoutError maps to `504` `app/api/chat.py:192` and kills process (already does — verify).
- [ ] **S2.4 Streaming vs non-streaming unified cancel** — Both endpoints share `process_registry`. On `stream` yield, check `request.is_disconnected()` each iteration.

**Tests to add:**

- `tests/integration/test_cancel_integration.py` — start `stream` with slow `FakeAdapter` (yield after 5s), call cancel, assert process terminated (`process.returncode is not None`), SSE ends with `event: cancel` not `[DONE]`.
- `tests/unit/test_process_registry.py` — register/cancel/cleanup race conditions.

**Exit:** Cancel kills subprocess <2s, disconnect auto-cancels, no `has_error` leak. `pytest -m integration -q` green.

**Depends:** S1 (rate limit uses same process registry for per-key concurrency limits if added later).

---

### S3 — Usage History, Pagination, Archive/Soft-Delete

**Goal:** Dashboard can paginate, search, archive (not hard-delete).

**Tasks:**

- [ ] **S3.1 Usage history** — `GET /api/chat/usage?limit&offset&from&to&harness&model` → queries `UsageRecord` `app/db/database.py:72`. Add `app/repositories/usage_repository.py` with `list_usage(user_id, filters)`. Add `app/api/usage.py` router, mount in `app/main.py:26`. Paginate with cursor or `limit/offset` (default `limit=20` max `100`).
- [ ] **S3.2 Conversation pagination** — Modify `app/api/chat.py:104` `list_conversations` to accept `?limit=20&offset=0&q=search` and `GET /api/chat/conversations/{id}` already has messages but add `?limit_messages`. Implement in `app/repositories/conversation_repository.py: fetch_conversation_summary` and `list_conversations_for_user` with `limit/offset` + `ilike` search on `title/content`.
- [ ] **S3.3 Archive soft-delete** — Add `Conversation.archived: bool` + `archived_at` + `deleted_at` `app/db/database.py:53` (migration via `alembic` or `create_all` for tests). `PATCH /conversations/{id}` `{"archived":true}`, `DELETE` becomes soft-delete (`deleted_at`), `POST /conversations/{id}/restore`. Filter archived out of `list` by default `?archived=false`.
- [ ] **S3.4 Migration** — Add `alembic/` or simple `init_db` `run_sync(Base.metadata.create_all)` handles new columns for tests; document in `docs/configuration.md`.

**Tests to add:**

- `tests/integration/test_usage_integration.py` — seed 3 `UsageRecord`, `GET /api/chat/usage` returns paginated, filters work, authz (user A cannot see user B's usage).
- `tests/integration/test_pagination_integration.py` — create 25 conversations, `GET ?limit=10` returns 10, `offset=10` next page, `q=searchterm` filters.
- `tests/integration/test_archive_integration.py` — archive → not in default list, `?archived=true` shows, restore → back.

**Exit:** Dashboard can replace `list_conversations` “return all” with paginated calls. All existing `GET /conversations` callers updated.

---

### S4 — SSE Completeness (IDs, Heartbeats, Reconnect, Lifecycle)

**Goal:** Mobile can reconnect; proxies don't drop idle streams.

**Tasks:**

- [ ] **S4.1 Event envelope** — Change `app/api/chat.py:276` and `app/api/openai.py:120` to send `event:` + `id:` + `retry:` fields per SSE spec. Events: `token`, `done`, `error`, `usage`, `cancel`. Example: `id: 42\nevent: token\ndata: {"choices":[{"delta":{"content":"hi"}}]}\n\n` + final `event: done\ndata: [DONE]\n\n`.
- [ ] **S4.2 Heartbeats** — Send `: keepalive\n\n` every 15s while `adapter.stream` is waiting (`asyncio.wait_for` timeout 15s branch yields heartbeat, not error). Add `X-Accel-Buffering: no` already present `app/api/chat.py:327`.
- [ ] **S4.3 Reconnect** — Accept `Last-Event-ID` header in `POST /messages/stream` (store `collected` with IDs in memory per `request_id` LRU, or DB `Message` as event log). On reconnect with `Last-Event-ID`, replay from that ID.
- [ ] **S4.4 Lifecycle events** — On stream start `event: start` with `{"model":..., "id":...}`, on end `event: usage` with token counts before `done`.

**Tests to add:**

- `tests/contract/test_sse_contract.py` — assert SSE lines start with `event:`/`id:`/`data:` and end with `[DONE]`.
- `tests/integration/test_sse_reconnect.py` — stream 3 tokens, disconnect, reconnect with `Last-Event-ID: 2`, expect token 3 replayed.
- `tests/performance/test_heartbeat.py` — mock slow adapter (no output 20s), assert heartbeats `: keepalive` every 15s (count).

**Exit:** `OkHttp EventSource` on Android can resume with `Last-Event-ID`; `pytest -m contract -q` green.

**Depends:** S2 (cancel shares IDs).

---

### S5 — Harness Lifecycle & Health

**Goal:** Install/refresh/health are real, not stubs.

**Tasks:**

- [ ] **S5.1 Job manager** — `app/services/harness_job_service.py` with `Job {id, harness, stage, logs[], exit_code}` stored in memory + `Harness` `app/db/database.py:40` `last_checked_at`. `POST /harnesses/{name}/install` `app/api/admin.py:41` now creates job, streams progress via `GET /harnesses/{name}/jobs/{id}/stream` (SSE), not hardcoded `accepted`. Allow-list `install_command` `app/clients/base.py:13` (only `npm install -g @scope/pkg`).
- [ ] **S5.2 Health** — `GET /health` `app/main.py:62` already `{"status":"ok"}` plus `GET /api/admin/harnesses/{name}/health` that checks `is_installed()` + `list_models()` latency + `model_cache` freshness (`model_refresh_seconds` `app/core/config.py:21`). Return `{"installed":bool,"authenticated":bool,"models":int,"latency_ms":int}`.
- [ ] **S5.3 Model refresh** — Keep `refresh_models` `app/clients/registry.py` but make it async job with `last_checked_at` update, not startup-only. Add `POST /harnesses/refresh` already `app/api/admin.py:36` to trigger job.

**Tests to add:**

- `tests/integration/test_harness_lifecycle.py` — `POST /install` with `FakeAdapter` (short `echo` command) returns job `id`, `GET /jobs/{id}` polls to `completed`, `GET /jobs/{id}/stream` yields `stage: running` lines.
- `tests/integration/test_health.py` — `GET /health` 200, `GET /harnesses/{name}/health` for installed vs not.

**Exit:** Dashboard `Harnesses` page can show real install progress & per-harness health.

---

### S6 — Credential Profiles (Wire Up `encrypt_secret`)

**Goal:** `encrypt_secret` `app/core/security.py:34` actually used; support `CLI Login` vs `env`.

**Tasks:**

- [ ] **S6.1 Schema** — New table `credential_profiles` (`id, user_id, harness, profile_name, auth_type, encrypted_token, status, last_checked_at`) + `app/db/database.py` model. Reuse `_fernet` `app/core/security.py:28` key derivation.
- [ ] **S6.2 API** — `POST /api/admin/harnesses/{name}/credentials` `{profile, auth_type, token}` → `encrypt_secret(token)` store, `GET /credentials`, `POST /credentials/{id}/check` → calls `adapter.authenticate()` `app/clients/base.py:43` and updates `status`, `DELETE /credentials/{id}` (decrypt never returns raw).
- [ ] **S6.3 Harvest existing env** — On startup, if `ANTHROPIC_API_KEY` etc present, auto-create profile with `auth_type=env` (masked display).
- [ ] **S6.4 Adapter env injection** — `app/clients/base.py:62` `env={**os.environ, **(env or {})}` already supports per-request env — wire credential profile's decrypted token into `env` when `harness` needs it.

**Tests to add:**

- `tests/unit/test_security.py` extend: `encrypt/decrypt` roundtrip already `tests/unit/test_security_utils.py:24` — add profile CRUD unit with real `Fernet` (no mock).
- `tests/integration/test_credentials_integration.py` — create profile, `GET` shows `status` but not raw token (assert `encrypted_token` not in response), `POST /check` updates `last_checked_at`.

**Exit:** `CredentialProfile` exists, `encrypt_secret` no longer dead, per-harness `authenticated` `app/api/admin.py:33` reflects real check.

**Depends:** S5 (health uses credential status).

---

### S7 — Tool Calling & Structured Output (Foundation, No Files Yet)

**Goal:** OpenAI-compatible `tools` pass-through; SSE `tool_call` events.

**Tasks:**

- [ ] **S7.1 Request schema** — Extend `ChatRequest` `app/api/openai.py:27` with `tools: list[ToolDef] | None`, `tool_choice`, `response_format: {type:"json_object"|"json_schema", schema}`. Validate with `Pydantic` but do not yet execute tools — just store & forward.
- [ ] **S7.2 Adapter tool parsing** — Update `parse_line` in `app/clients/codex.py:166`, `app/clients/opencode.py:193`, `app/clients/commandcode.py:224` to detect `tool_call` JSON (`{"tool":...}`) and yield `text=""` + `metadata={"tool_call":...}`. Stream should yield `event: tool_call` then `event: tool_result` (stub result `{"status":"requires_action"}`) until execution engine added later.
- [ ] **S7.3 Structured output** — If `response_format` present, wrap harness output validation: try `json.loads(result.text)`, if fails return `502` with `malformed-output` code and retry once.
- [ ] **S7.4 OpenAI SSE tool delta** — Follow `chat.completion.chunk` spec `choices[0].delta.tool_calls` for compatibility.

**Tests to add:**

- `tests/contract/test_tool_contract.py` — `POST /v1/chat/completions` with `tools=[{type:"function", function:{name:"get_weather"}}]` returns `tool_calls` in `choices[0].message` (mocked adapter yields tool JSON).
- `tests/integration/test_stream_tool_events.py` — stream yields `event: tool_call` SSE before `event: token`.
- `tests/unit/test_structured_output.py` — `response_format json_schema` valid vs invalid JSON.

**Exit:** Client can send `tools` and receive `tool_calls` without server execution — execution engine deferred to next plan.

**Depends:** S4 (SSE event types).

---

### S8 — Polish: Key Rotation, Error Standardization, Observability

**Goal:** Production-grade ops.

**Tasks:**

- [ ] **S8.1 Key rotation** — `POST /api/admin/keys/{id}/rotate` → generate new `raw/prefix/digest` `app/core/security.py:21`, keep old prefix for 5m grace, return new `key` once. `tests/integration/test_key_rotation.py`.
- [ ] **S8.2 Unified errors** — Create `app/shared/errors.py` `ErrorCode` enum (`harness_error`, `rate_limited`, `auth_error`, `validation_error`) and middleware that formats all errors as `{"error":{"code":..., "message":..., "type":..., "retryable":bool}}` (replace inconsistent `{"detail":...}` vs `{"error":...}` `AFQAUDIT.md:198`).
- [ ] **S8.3 Request IDs & structured logs** — Add `app/middleware/request_id.py` (`X-Request-ID` UUID, `request.state.request_id`), `app/middleware/logging.py` JSON logs with `request_id`, `harness`, `model`, `user_id`, redaction of `Authorization`. Replace `uvicorn` default.
- [ ] **S8.4 Metrics** — `GET /metrics` Prometheus (`requests_total`, `harness_latency_ms`, `stream_duration`) via `prometheus_client` (optional dep, guard with `import` check). No hard dep — see `test-guard` Rule 23.

**Tests to add:**

- `tests/integration/test_key_rotation.py`
- `tests/contract/test_error_schema.py` — all 400/401/403/429/502 return `error.code`.
- `tests/security/test_request_id.py` — `X-Request-ID` echoed, logs contain it (capture `caplog`).

**Exit:** `docs/api.md` updated with error codes, `GET /metrics` 200.

---

## 3. Session Sequencing & Resumption

1. Pick next unchecked session (e.g., `S1`).
2. Create branch `feat/s1-rate-limit` from `main`.
3. Implement tasks in order, commit per sub-task (`feat(rate-limit): ...`).
4. After each sub-task: `compileall -q app` + `pytest -m <session_mark> -q`.
5. At session end: `pytest -q` must be 96 + new count; open PR, update this file's checkboxes (`- [x]`).
6. If interrupted mid-session: commit WIP, push, note next unchecked `- [ ]` in PR description.

**Progress tracker (check as you merge):**

- [x] S1 Security & Rate Limit — done (116 tests green, middleware + quota + allowed_models + sanitization)
- [x] S2 Cancel & Lifecycle — done (127 tests green, process_registry + cancel endpoints + auto-disconnect)
- [x] S3 Usage/Pagination/Archive — done (141 tests green, usage + pagination/search + archive/soft-delete)
- [x] S4 SSE Completeness — done (148 tests green, sse envelope + heartbeat + reconnect + lifecycle)
- [x] S5 Harness Lifecycle & Health — done (160 tests green, job manager + install/health + refresh)
- [x] S6 Credential Profiles — done (173 tests green, encrypt wiring + env injection + harvest)
- [ ] S7 Tool Calling
- [ ] S8 Polish

---

## 4. Testing Strategy Per Session

- **Unit:** Real objects (`HarnessModel` `app/models/harness.py:3`, `User` `app/db/database.py:14`), no mocks of internal helpers. Parametrize via `@pytest.mark.parametrize` (see `tests/unit/test_model_utils.py:6`).
- **Integration:** Real `test_engine` `tests/conftest.py:16` `sqlite+aiosqlite:///:memory:` + `Base.metadata.create_all` (Rule 9). Override `get_db` `tests/conftest.py:35`, patch `SessionLocal` `tests/conftest.py:39` for streaming background sessions.
- **e2e/Contract:** `ASGITransport` `tests/conftest.py:40` full router, assert `openapi.json` `tests/contract/test_api_contract.py:5`.
- **Performance:** `<1s` for 10k parses `tests/performance/test_performance.py:9`, `<200ms` avg conversation create, 50 reads `rps>10`.
- **Security:** JWT tamper `tests/security/test_security.py:11`, `allowed_models` 403, rate `429`.

New tests live in `tests/{unit,integration,e2e,security,performance,contract}/` with `pytestmark = pytest.mark.<type>` `pytest.ini:3`.

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| SQLite concurrency `IllegalStateChangeError` in burst tests | Keep `S3` pagination tests sequential; for true concurrency add `async_sessionmaker` per request in `client` fixture `tests/conftest.py:35` (already per-request via `TestSessionLocal`). |
| `MODEL_CACHE` global shared across tests | `seed_models` fixture `tests/integration/test_chat_integration.py:6` `MODEL_CACHE.clear()` autouse, isolated per test. |
| `process.kill()` orphan on Windows | Guard `ProcessLookupError` `app/clients/base.py:71` already; add `psutil` check in S2 if needed. |
| `encrypt_secret` key rotation invalidates old profiles | Store `key_version` in `credential_profiles`, decrypt with old `credentials_key` fallback. |
| SSE proxy buffering | Keep `X-Accel-Buffering: no` `app/api/chat.py:327`, heartbeats `: keepalive` S4. |

---

## 6. Appendix: File Map

- Wiring: `app/main.py:22` (CORS, lifespan `init_db` `app/db/database.py:92` + `refresh_models` `app/clients/registry.py`), `app/config/settings.py` (re-export).
- Auth: `app/api/auth.py:27` `current_user` (JWT `app/core/security.py:17`), `app/api/openai.py:47` `resolve_identity` (JWT vs `hash_api_key` `app/core/security.py:25`).
- Chat: `app/api/chat.py:104` `list_conversations` → `app/repositories/conversation_repository.py:15` → `app/services/model_service.py:45`.
- Clients: `app/clients/base.py:58` `run`/`stream` (subprocess), `app/clients/claude.py:8` etc., `app/clients/generic.py:4` `GenericAdapterConfig`.
- Models: `app/models/harness.py:3`, `app/db/database.py:14` (ORM), `app/domain/harness.py:23` (port).

---

*Last updated: after S6 (feat/s6-credentials) — 173 tests green (96 + 77 S1-S6). Excludes file/image upload per request. Next: S7 Tool Calling.*
