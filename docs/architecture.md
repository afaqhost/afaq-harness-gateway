# Architecture

## Request Flow

The gateway receives an OpenAI-shaped request, authenticates the caller, parses the model identifier, resolves a harness adapter, runs the local CLI, and maps the adapter output back to an OpenAI chat-completion response or an SSE stream.

```text
Client
  -> FastAPI route
  -> Bearer identity resolution
  -> model parser: harness / provider / model
  -> HarnessAdapter
  -> local CLI process
  -> normalized response
```

## Layer Map (Target Architecture & Current Direction)

The layer map represents the target architectural direction. While new capabilities adhere strictly to this structure, several inbound controllers (`chat.py`, `openai.py`) still contain legacy inline persistence, session management, and multi-step orchestration that are being iteratively refactored into domain services.

| Layer | Location | Rule | Current Status |
| --- | --- | --- | --- |
| `controllers` (inbound) | `app/api/*` | Thin: parse request → call **one** service → shape response. No business rules, no SQL. | Current direction; `chat.py` and `openai.py` contain inline persistence. |
| `services` | `app/services/*` | Business verbs: `quota_service`, `harness_job_service`, `project_update_service`, `model_service`, `credential_service`, `os_terminal`. Depend on interfaces, never on HTTP/SQL. | Established; owns business rules, concurrency limits, and process lifecycle. |
| `repositories` | `app/repositories/*` + `app/db/database.py` ORM | Only place that knows DB/SQL. `auth_repository`, `conversation_repository`, `usage_repository`. | In transition; entities encapsulated, inline controller queries moving here. |
| `clients` (outbound) | `app/clients/*` | Hide harness CLIs behind `HarnessAdapter` (`base.py`). Registry + `MODEL_CACHE` in `clients/registry.py` (with Redis mirror). | Unified contract governing CLI execution, discovery, and output parsing. |
| `models` | `app/models/harness.py` | Serializable shapes `HarnessModel`/`HarnessResult` (single source; split DTO only when wire shape differs). | Stable domain models. |
| `transport` | `app/transport/*` | Wire mechanics: `identity.py` (stream identity isolation), `history.py` (SSE replay, Redis fallback), `stream.py` (heartbeat). No business meaning. | Cohesive leaf mechanics with zero business logic. |
| `config` | `app/config/settings.py` (facade `app/core/config.py`) | Env + DI composition root, secret validation, trusted proxy parsing. | Validated settings facade with production fail-fast checks. |
| `middleware` | `app/middleware/*` | `rate_limit` (Redis/in-memory with shadow bucket), `request_id`, `logging` (JSON, redacted). | Hardened; enforces proxy trust boundaries. |
| `shared` | `app/shared/*` | Leaf utilities (`model_utils`, `prompt_utils`, `sse`, `time`, `errors`, `structured_output`) — no app imports. | Pure leaf utilities. |

`app/domain/harness.py` exposes `HarnessPort` Protocol + `ChatService` (used by unit tests; controllers currently resolve via `clients/registry.get_adapter` — deliberate seam for future DIP injection). `app/harnesses/registry.py` is a backwards-compatible facade re-exporting `app/clients/*`.

## Main Components

| Component | Responsibility |
| --- | --- |
| `app/main.py` | FastAPI app, lifespan (`init_db` → `harvest_env_credentials` → `refresh_models`), exception → `error_payload` mapping, page routes, health |
| `app/api/auth.py` | Bootstrap, login, strict JWT-only `current_user` and `admin_user` dependencies |
| `app/api/openai.py` | `GET /v1/models`, `POST /v1/chat/completions` (tools, response_format, isolated SSE stream identity, `Last-Event-ID` replay, cancel) |
| `app/api/chat.py` | Dashboard conversations/messages (CRUD, soft-delete/restore, search, pagination), streaming with heartbeat + cancel |
| `app/api/admin.py` | Authenticated harness inventory/health; administrator-only refresh, install/update jobs, project updates, users, keys + rotation |
| `app/api/credentials.py` | Credential profiles (encrypted, per-harness `profile_name`, `check` → `status`) |
| `app/api/usage.py` | Filtered usage listing (`from`/`to`, harness/model, pagination) |
| `app/api/os_terminal.py` | OS Terminal REST lifecycle endpoints and authenticated WebSocket proxy |
| `app/api/metrics.py` | Prometheus `/metrics` (or `501` when client not installed) |
| `app/clients/*` | `HarnessAdapter` + concrete adapters (`claude`, `codex`, `opencode`, `commandcode`, `agy`, `pi`, generic) + queued `run`/`stream` |
| `app/db/database.py` + `app/repositories/*` | SQLite WAL engine, models (`User`, `APIKey`, `Harness`, `CredentialProfile`, `Conversation`, `Message`, `UsageRecord`, `QuotaReservation`), queries |
| `app/static/` + `app/templates/` | Bilingual dashboard |

## Authentication Boundaries

The gateway strictly partitions authentication between internal dashboard operations and external model consumption:

- **JWT-Only Dashboard & Administration:** Protected dashboard routes—including conversations, harness management, user/key management—and the OS terminal (`/terminal`, `/api/admin/terminal/*`) require a signed JWT issued via `POST /api/auth/login`. Public login/bootstrap/setup-status endpoints are the intentional exceptions. Authentication dependencies (`current_user`, `admin_user`) reject API keys with `HTTP 401 Unauthorized`.
- **API Keys Scoped to OpenAI Routes:** External clients authenticate to `/v1/models` and `/v1/chat/completions` using Bearer API keys (`afaq_...`). API keys cannot authenticate to dashboard or administrative endpoints. JWTs are also accepted on `/v1/*` routes to support web-based chat and integration testing.
- **Inactive User Enforcement:** Inactive accounts (`user.is_active == False`) are rejected at the login endpoint and cannot obtain access tokens.
- **Production Secret Validation:** When `DEBUG=false`, `app/core/config.py` enforces fail-fast validation rejecting weak secrets, values under 32 characters, and the public placeholder secrets from `.env.example`.
- **Trusted Proxy IP Resolution:** `RateLimitMiddleware` resolves client IP from direct socket peers by default. `X-Forwarded-For` headers are only parsed when the immediate peer IP is listed in `TRUSTED_PROXIES`.

## Password Security & Bcrypt Boundary

Password hashing is implemented directly via `bcrypt` in `app/core/security.py`, eliminating legacy dependencies and deprecation warnings:
- **Explicit 72-Byte UTF-8 Ceiling:** Passwords are explicitly validated against `BCRYPT_MAX_PASSWORD_BYTES = 72`. Attempting to hash a password exceeding 72 UTF-8 bytes raises a `ValueError` immediately, preventing silent truncation attacks.
- **Verification Safety:** Password verification safely returns `False` for passwords exceeding 72 bytes or malformed hashes, with zero library warnings.

## Atomic Quota Reservations (`QuotaReservation`) & DB Session Ownership

To prevent concurrent requests from exceeding daily or monthly limits, `app/services/quota_service.py` implements atomic two-phase reservations:
- **Two-Phase Reservation Pattern:**
  1. *Reservation Phase:* Before starting a harness process, `reserve_quota()` atomically calculates existing usage plus active reservations within an isolated database transaction. If limits are reached, the request is rejected with `HTTP 429 Too Many Requests`.
  2. *Finalization Phase:* When the harness finishes successfully, `finalize_reservation()` writes the permanent `UsageRecord` and removes the reservation token within a single atomic commit.
  3. *Release Phase:* If a request fails, times out, or is cancelled, `release_reservation()` removes the reservation token, restoring available quota.
- **Streaming DB-Session Ownership:** Long-running harness CLI streaming and SSE loops do not hold database connections open. Independent, short-lived sessions are acquired strictly for the initial reservation and terminal finalization.
- **Streaming Finalization Guard:** If usage finalization fails at the end of an SSE stream, the gateway suppresses the `data: [DONE]` event and emits a terminal `event: error` chunk, preventing the client from incorrectly assuming durable success.

## Subprocess Timeout, Reaping & Stderr Draining

Harness CLI execution is protected by deterministic subprocess management in `app/clients/base.py`:
- **Deterministic Timeout & Cleanup (`communicate_with_timeout`):** When a subprocess exceeds `run_timeout` or the calling task is cancelled, the helper kills the process (`process.kill()`), awaits process termination bounded by a cleanup timeout (`asyncio.wait_for(process.communicate(), timeout=2.0)` or `process.wait()`), and closes stdout/stderr transports. This eliminates un-reaped zombie processes and leaked transport warnings.
- **Concurrent Bounded Stderr Draining:** During streaming runs, `_BoundedStderrDrainer` reads the child's stderr continuously into a bounded 64 KB ring buffer. This prevents child processes from deadlocking when emitting voluminous diagnostic logs to full OS pipe buffers.

## OS Terminal PTY Architecture

The `/terminal` dashboard feature provides an interactive login shell in the browser (`app/services/os_terminal.py`):
- **Multithread-Safe Spawning:** Replaced legacy `pty.fork()` with `os.openpty()` and `os.posix_spawn()`. Standard file actions (`POSIX_SPAWN_DUP2`, `POSIX_SPAWN_CLOSE`) attach the slave PTY file descriptor to child stdin/stdout/stderr without running Python application code between fork and exec in the parent runtime.
- **Child Process Wrapper (`app.services.os_terminal_child`):** A lightweight standalone wrapper runs post-exec in the child process, acquires controlling terminal ownership (`TIOCSCTTY`), sets environment variables (`TERM=xterm-256color`, `AFAQ_TERMINAL=1`), enters the requested working directory, and executes the login shell.
- **POSIX-Only:** Terminal functionality requires POSIX primitives (`openpty`, `posix_spawn`) and is unavailable on Windows (returns `HTTP 503`).
- **Access Boundary:** Shell creation is restricted to administrative users authenticated via JWT.

## Model Cache

`refresh_models()` populates the local in-memory model cache (`MODEL_CACHE`) during FastAPI startup and background refresh:
- **Authoritative Local Discovery:** When local discovery succeeds and returns models, it updates `MODEL_CACHE` and mirrors to Redis asynchronously.
- **Fail-Safe Hydration:** If local discovery fails or yields no models (e.g. an adapter only installed on other replicas), the local cache hydrates from the shared Redis mirror.
- **Non-Destructive Mirror:** Transient discovery errors or absent local tools do not delete the shared mirror.
- **Non-Blocking Reads:** Request-time `cached_models()` serves the local hot cache synchronously without network I/O or Redis calls. `POST /api/admin/harnesses/refresh` rebuilds the cache and mirror.

## Shared Async Redis & Multi-Replica Architecture

A centralized async Redis provider (`app/core/redis.py`) manages connection pooling via `redis.asyncio`:
- **Connection Lifecycle:** Lazy initialization; awaits graceful pool closure during FastAPI lifespan shutdown with narrow exception logging.
- **Bounded Timeouts:** Configurable connect and socket timeouts (`REDIS_CONNECT_TIMEOUT_SECONDS`, `REDIS_SOCKET_TIMEOUT_SECONDS`, defaulting to 2.0s) prevent slow Redis instances from blocking the event loop.
- **Narrow Exception Handling:** Catches specific Redis and timeout exceptions (`RedisError`, `RedisTimeoutError`, `ConnectionError`, `asyncio.TimeoutError`, `OSError`) to trigger graceful degradation with structured warnings.
- **SSE History:** `RedisHistoryStore` pipelines `LPUSH` + `LTRIM` + `EXPIRE` atomically per event and awaits execution. Replays use awaited async `LRANGE`. Propagated through stream identity, process registry, and SSE controllers without fire-and-forget tasks.
- **Harness Job Mirroring:** Harness job status sync and deletion are awaited async calls. The service lock is released prior to all network I/O to avoid head-of-line blocking.
- **Rate Limiter:** `RedisRateLimiter` executes an atomic Lua script (`INCR` + conditional `EXPIRE`) to prevent key leaks without race conditions. A local shadow bucket remains active on every request, ensuring that a Redis outage does not reset effective counts or grant burst allowances. `reset()` is strictly local-only (never issues `FLUSHDB`, never schedules orphan coroutines, never makes network calls).

### Single- vs Multi-Replica Guarantees & Fallback Limitations

- **Single-Replica:** Fully functional with Redis disabled (`REDIS_ENABLED=false` or empty `REDIS_URL`). Uses local in-memory data structures for SSE replay history, model caching, job tracking, and rate limiting with zero external dependencies.
- **Multi-Replica:** When Redis is available, provides cross-pod SSE replay, shared rate limit accounting across nodes, harness job visibility, and model cache hydration. In the event of Redis downtime, latency spikes, or network partitions, each replica degrades smoothly to local in-memory enforcement without blocking the event loop.
- **History Fallback Limitation:** Events buffered in local memory during a Redis outage are not backfilled into Redis upon recovery. Reconnecting clients during an outage will only be able to replay events if routed to the replica that originated the stream.

## Model Identifiers

The public format is `harness//model` when no separate provider is used. OpenCode models preserve their provider/model value after the harness prefix, for example `opencode//opencode/big-pickle`. The API removes the harness prefix before passing the model value to the adapter.

## Persistence

SQLite (WAL: `journal_mode=WAL`, `synchronous=NORMAL`, 64 MB cache, 5 s `busy_timeout` in `app/db/database.py:13`) stores users, hashed API keys, conversations (with `archived`/`deleted_at` + restore), messages, harness records (`last_checked_at`), credential profiles, usage records, and quota reservations. The default is `data/afaq.db`; override with `DATABASE_URL`.
