# Afaq Harness Gateway — Architecture and Production-Readiness Report

Review date: 2026-10-04
Reviewed revision: `e0d9cd8`
Branch: `main`
Scope: Application source, test suite, security boundaries, deployment assets, transport mechanics, and operational persistence.

---

## 1. Executive Summary

Afaq Harness Gateway is a local-first, OpenAI-compatible gateway that unifies disparate AI command-line interfaces behind normalized HTTP and Server-Sent Events (SSE) interfaces. Its core design separates generic OpenAI-style API orchestration from CLI-specific command syntax and output stream formatting through an extensible `HarnessAdapter` interface.

Following the initial audit at revision `ca38352` (`881616a`), the codebase underwent a comprehensive production hardening and defect-remediation program spanning seven commits:
1. `881616a` — Architecture and production-readiness audit.
2. `a3f6caa` — Authentication boundary isolation, inactive user rejection, production secret entropy enforcement, and trusted proxy rate limiting.
3. `dccba91` — Non-root container runtime (`node`), loopback-only host publishing, private Redis network, and CI container deployment smoke testing.
4. `0e20ab3` — SSE replay isolation per stream identity and concurrent bounded stderr draining.
5. `217c7ba` — Two-phase atomic quota reservations and durable usage accounting.
6. `13d7e78` — Fully asynchronous shared Redis client provider, bounded network timeouts, and fail-safe local shadow rate limiting.
7. `e0d9cd8` — Direct bcrypt integration with explicit 72-byte ceiling, multithread-safe `openpty` + `posix_spawn` child PTY wrapper, deterministic subprocess timeout cleanup, and warning-free test execution.

### Verification Status & Quality Gates

The gateway meets all documented production-readiness gates at revision `e0d9cd8`:
- **Automated Test Suite:** `.venv/bin/python -m pytest -q -W error` passes **328 tests with zero warnings** in ~92 seconds.
- **Static Compilation:** `.venv/bin/python -m compileall -q app` passes with zero syntax or compilation errors.
- **Frontend Syntax Validation:** `node --check app/static/app.js` passes cleanly.
- **Git Hygiene:** `git diff --check` reports zero whitespace or formatting anomalies.
- **Container Smoke Test:** Docker image build, unprivileged user execution, container port binding (`0.0.0.0:3500`), and Compose loopback publishing (`127.0.0.1:3500:3500`) pass regression validation.

All P1, P2, and P3 findings identified in the initial review have been resolved and verified with dedicated regression tests.

---

## 2. System Purpose & Request Topologies

The gateway standardizes local AI harness execution into two distinct request topologies:

```text
External Client (OpenAI-compatible)
  -> RateLimitMiddleware (peer IP / trusted proxy / Bearer bucket)
  -> resolve_identity (API key 'afaq_...' or JWT)
  -> POST /v1/chat/completions
  -> Model policy check (allowed_models)
  -> QuotaService.reserve_quota (atomic daily/monthly reservation)
  -> HarnessQueue (concurrency semaphore + backpressure)
  -> HarnessAdapter.run() or stream()
  -> Subprocess execution (bounded stderr drain + timeout protection)
  -> QuotaService.finalize_reservation (durable UsageRecord persistence)
  -> Response JSON or SSE text/event-stream chunks
```

```text
Browser Dashboard & Administration
  -> RateLimitMiddleware (socket peer or trusted reverse proxy)
  -> current_user / admin_user (strict JWT-only Bearer dependency)
  -> Dashboard routes (/chat, /harnesses, /keys, /users, /usage, /setup)
  -> Admin Terminal (REST session lifecycle + WebSocket PTY)
  -> OsTerminalService (openpty + posix_spawn + child wrapper)
  -> Bidirectional WebSocket frame stream
```

### Primary Interfaces

- **OpenAI-Compatible API (`/v1`):** `GET /v1/models` and `POST /v1/chat/completions` supporting streaming (`stream: true`), structured output validation (`response_format`), function/tool calling (`tools`, `tool_choice`), and reconnectable SSE streams.
- **Dashboard API (`/api/*`):** User registration/bootstrap, login sessions, conversation management (with archiving and soft deletion), key generation and immediate-revocation rotation, credential profile encryption, and asynchronous harness installation/update jobs.
- **Admin OS Terminal (`/terminal`, `/api/admin/terminal/*`):** REST session lifecycle management paired with a WebSocket endpoint delivering interactive, full-duplex POSIX login shell access.
- **Observability & Diagnostics:** `/health` (lightweight liveness check), `/metrics` (Prometheus counters and latency histograms), request ID propagation (`X-Request-ID`), and redacted structured JSON logging.

---

## 3. Architecture Map (Target Architecture & Current Direction)

The codebase follows a layered modular structure. While core domains are cleanly isolated into dedicated packages, several controllers are in transition and still maintain direct persistence or workflow logic.

| Layer | Module Path | Current Responsibility | Layering Status & Target Direction |
| --- | --- | --- | --- |
| **Composition** | `app/main.py` | Lifespan orchestration, exception handlers, router registration, middleware mounting. | Complete. Coordinates startup discovery and graceful teardown. |
| **Inbound Controllers** | `app/api/*` | Request validation, auth dependency enforcement, response formatting, SSE orchestration. | Current direction. `chat.py` and `openai.py` contain inline persistence; continuing migration toward thin service calls. |
| **Domain & Services** | `app/services/*` | Business verbs: quota reservations, credential encryption, harness job queue, process tracking, terminal PTY. | Cohesive. Fully owns business policies, concurrency gates, and system process lifecycles. |
| **Persistence** | `app/repositories/*`, `app/db/database.py` | SQLAlchemy declarative models, SQLite WAL configuration, query encapsulation. | Transitioning. Core entities wrapped in repositories; remaining raw queries are being consolidated. |
| **Outbound Adapters** | `app/clients/*` | CLI discovery, command construction, process spawning, bounded stderr draining, output parsing. | Solid abstraction. `HarnessAdapter` contract governs all external CLI interactions uniformly. |
| **Transport** | `app/transport/*` | Stream identity scoping, SSE formatting, reconnect replay buffers, keepalive heartbeats. | Cohesive leaf mechanics with zero business domain entanglement. |
| **Configuration** | `app/config/settings.py`, `app/core/config.py` | Pydantic settings loading, production secret entropy verification, trusted proxy parsing. | Canonical settings entry point re-exports settings facade; validated on startup. |
| **Middleware** | `app/middleware/*` | Request tracing (`request_id`), structured JSON logging with secret redaction, rate limiting. | Hardened. Enforces trusted proxy boundaries and resilient shadow-bucket accounting. |
| **Shared Utilities** | `app/shared/*` | Error sanitization, model string splitting, prompt templates, tool schemas, time helpers. | Pure leaf utility functions with no inbound application dependencies. |
| **Browser UI** | `app/templates/`, `app/static/` | Bilingual (Arabic/English) vanilla JavaScript SPA, CSS styling, terminal client. | Functional monolithic client (`app.js`, 2,101 lines; `app.css`, 2,718 lines). |

---

## 4. Production Hardening Implementation Details

### 4.1 Authentication & Credential Boundary Separation

Prior to hardening, API keys owned by administrators were accepted by `current_user`, granting external model keys full administrative access to the dashboard and host terminal.

The security boundary is now strictly partitioned:
- **JWT-Only Dashboard & Administration:** `app/api/auth.py:current_user` extracts Bearer tokens and exclusively processes signed JWTs containing a valid user ID subject (`sub`). API keys passed to `/api/*` or `/terminal` routes are rejected with `HTTP 401 Unauthorized`.
- **API Keys Scoped to Model Execution:** API keys (`afaq_...`) are authenticated exclusively within `app/api/openai.py:resolve_identity`. They grant access strictly to `/v1/models` and `/v1/chat/completions`.
- **Inactive Account Rejection:** `login` checks `user.is_active` simultaneously with password verification. Disabled accounts cannot obtain JWTs.
- **Fail-Fast Secret Validation:** When `DEBUG=false`, `app/core/config.py:validate_production_settings` rejects empty secrets, short secrets (<32 characters), known weak strings, and the exact public placeholder tokens from `.env.example`.
- **Trusted Proxy Rate Limiting:** `RateLimitMiddleware` defaults to using the direct TCP socket peer address. Forwarded IP headers (`X-Forwarded-For`) are only honored when the socket peer matches an address in `TRUSTED_PROXIES`.

### 4.2 Atomic Quota Reservations (`QuotaReservation`)

To eliminate concurrency race conditions where multiple requests could bypass daily or monthly limits, `app/services/quota_service.py` implements a two-phase reservation pattern:
- **Phase 1 (Atomic Reservation):** Before invoking any harness CLI, `reserve_quota()` performs an atomic check against existing `UsageRecord` totals and active, unexpired `QuotaReservation` records within an isolated database transaction. If limits are reached, `HTTP 429 Too Many Requests` is raised immediately.
- **Phase 2 (Durable Finalization / Release):** When a harness process completes successfully, the reservation is durably finalized into a permanent `UsageRecord` row and the reservation token is deleted. If the request fails, times out, or is cancelled, `release_reservation()` removes the reservation, restoring the user's available quota.
- **Streaming Guarantees:** During SSE streaming, database sessions are not held open across long-running child processes. A separate, short-lived session finalizes quota before emitting the terminal `[DONE]` event. If finalization fails, the stream terminates with an error event instead of falsely reporting success.

### 4.3 Shared Asynchronous Redis Provider & Resilient Fallbacks

Redis interactions have been migrated entirely to `redis.asyncio` via a centralized provider (`app/core/redis.py`):
- **Lifecycle & Pooling:** A shared connection pool is lazily initialized and gracefully closed during application lifespan shutdown.
- **Bounded Latency:** Connect and socket operations have strict 2.0-second timeouts (`REDIS_CONNECT_TIMEOUT_SECONDS`, `REDIS_SOCKET_TIMEOUT_SECONDS`). Redis stalls or partitions cannot block the async event loop.
- **Pipelined Atomic History:** `RedisHistoryStore` executes `LPUSH`, `LTRIM`, and `EXPIRE` as a single pipelined command block, awaiting results asynchronously.
- **Fail-Safe Rate Limiting:** `RedisRateLimiter` executes an atomic Lua script for increments and expiry. A local in-memory shadow bucket tracks requests concurrently; if Redis fails, the local limiter takes over without resetting counts or failing open.
- **Model Cache Hydration:** Discovery refreshes the shared Redis mirror when local CLI discovery succeeds. If local discovery encounters transient failures, the local cache safely hydrates from Redis without clearing the shared mirror.

### 4.4 Stream Identity Isolation & Stderr Backpressure Handling

To resolve event collision and deadlock during streaming completions:
- **Isolated Stream Identities (`StreamIdentity`):** Replay buffers are keyed strictly by user ID and a validated `X-Stream-ID` (`openai:{user_id}:{stream_id}` or `conv:{user_id}:{conv_id}:{stream_id}`). Concurrent requests for the same user cannot cross-contaminate replay histories.
- **Strict Reconnection Validation:** Clients resuming a stream via `Last-Event-ID` must supply the matching `X-Stream-ID`. Mismatched or missing headers are rejected with `HTTP 400 Bad Request`.
- **Concurrent Bounded Stderr Drainer:** `HarnessAdapter.stream()` attaches a concurrent `_BoundedStderrDrainer` task to every running CLI process. Stderr is continuously read into a bounded ring buffer (64 KB) throughout the process lifetime. This prevents child processes from deadlocking when emitting voluminous diagnostic logs to full OS pipe buffers.

### 4.5 Cryptographic Boundaries & Direct Bcrypt Migration

- **Explicit 72-Byte Bcrypt Ceiling:** The gateway directly invokes `bcrypt` with `rounds=12`, removing `passlib`. Input passwords are explicitly validated against a 72-byte UTF-8 ceiling (`BCRYPT_MAX_PASSWORD_BYTES = 72`), preventing silent truncation attacks.
- **Secret Encryption:** Credential profiles are encrypted at rest using Fernet with keys derived via SHA-256 from `CREDENTIALS_KEY`.
- **API Key Storage:** Raw keys are generated with 32 bytes of cryptographic entropy (`afaq_...`), and only their SHA-256 digests and display prefixes are stored.

### 4.6 Multithread-Safe POSIX OS Terminal

The interactive terminal (`app/services/os_terminal.py`) provides browser-based login shell access:
- **Safe Process Spawning:** Replaced legacy `pty.fork()` with `os.openpty()` and `os.posix_spawn()`. Child file actions (`POSIX_SPAWN_DUP2`, `POSIX_SPAWN_CLOSE`) configure standard streams without running Python runtime code between fork and exec.
- **Child Wrapper (`app.services.os_terminal_child`):** A standalone wrapper executes post-exec in the child process to establish controlling terminal semantics (`TIOCSCTTY`), apply `TERM=xterm-256color`, change directories, and exec the target shell.
- **Privilege Scoping:** Terminal creation requires an administrative JWT. WebSockets validate the JWT before upgrading connections.

### 4.7 Deterministic Subprocess & Resource Cleanup

- **Timeout & Signal Reaping:** `app/clients/base.py:communicate_with_timeout` wraps subprocess execution. Upon timeout or task cancellation, child processes receive `SIGKILL` and are awaited (`process.wait()`), guaranteeing child reaping and closing standard I/O pipes.
- **Connection Pool Hygiene:** Test suites and production endpoints enforce proper async database session closure and connection check-in, preventing connection leaks.

### 4.8 Containerization & Deployment Hardening

- **Unprivileged Container Runtime:** The Docker image runs as the unprivileged `node` user. Global npm directories and local binary folders (`~/.local/bin`, `~/.npm-global`) are owned by that user.
- **Interface Binding:** Uvicorn binds to `0.0.0.0:3500` inside the container, ensuring traffic forwarded from the host is accepted.
- **Loopback Host Exposure:** `docker-compose.yml` binds the published port explicitly to `127.0.0.1:3500:3500`, preventing inadvertent exposure to public network interfaces.
- **Private Redis Network:** Redis runs without published host ports on a private Docker bridge network. Compose utilizes healthcheck dependencies (`condition: service_healthy`) to ensure Redis is available before starting the gateway.
- **Filesystem Persistence:** Named volumes persist database files (`/app/data`), CLI storage (`/app/storage`), and user-installed binaries. Mounting the host `docker.sock` is eliminated.

---

## 5. Verification Evidence & Quality Gates

The production readiness of revision `e0d9cd8` is established by the following concrete verification results:

```text
============================== 328 passed in 92.46s ==============================
Warnings: 0 (enforced via -W error)
Bytecode compilation: app/ package compileall OK (exit code 0)
Frontend validation: app/static/app.js syntax check OK (exit code 0)
Git diff check: clean (exit code 0)
```

### Coverage by Functional Domain

- **Security & Authentication (`tests/security/`):** Confirms admin API key rejection from terminal/admin routes, inactive user login denial, production secret validation, IP spoofing defenses, and request ID tracking.
- **Quota & Accounting (`tests/integration/test_quota_reservation_integration.py`):** Proves atomic daily/monthly limit enforcement, durable finalization, cancellation release, and stream termination behavior under concurrency.
- **Async Redis & Resilience (`tests/unit/test_redis_async_hardening.py`):** Validates zero synchronous Redis calls, pipelined history operations, non-blocking failure fallbacks, shadow rate limiting, and clean lifespan pool teardown.
- **Transport & Streams (`tests/integration/test_sse_reconnect.py`, `tests/unit/test_transport_identity.py`):** Exercises concurrent stream replay isolation, header validation, and reconnect sequencing.
- **Subprocess & Harness Lifecycle (`tests/unit/test_harness_adapters.py`, `tests/unit/test_subprocess_timeout.py`):** Confirms bounded stderr draining under high volume and deterministic subprocess termination.
- **Terminal PTY (`tests/integration/test_os_terminal.py`):** Verifies `openpty` + `posix_spawn` lifecycle, session isolation, window resizing, and WebSocket authentication.
- **Container Deployment (`tests/unit/test_docker_deployment.py`):** Validates Dockerfile directives, unprivileged user setup, and Docker Compose networking.

---

## 6. Known Limitations & Technical Debt

To maintain operational integrity, operators must account for the following architectural constraints:

1. **Schema Evolution:** The application initializes database schemas via `Base.metadata.create_all()`. There is currently no database migration framework (e.g., Alembic) or automated rollback tooling. Upgrades requiring schema adjustments must be handled with care.
2. **SQLite Database Backups:** SQLite WAL mode provides excellent performance and concurrency for single-node deployments. However, backup and disaster recovery remain operator-managed responsibilities. Operators must periodically back up `data/afaq.db` and associated WAL files.
3. **Replica-Local State During Redis Outages:** When Redis is unavailable, replicas degrade to in-memory history and shadow rate limiting. Cross-replica rate-limit coordination is unavailable during the outage, and history events buffered locally are not backfilled after reconnection. Reconnecting clients must route to the originating replica to retrieve events generated during an outage.
4. **Privileged Terminal Environment:** The admin OS terminal executes shells as the gateway process's user (`node` in Docker, host user in bare-metal). While strictly protected by JWT admin authentication, host access should be factored into overall system security posture.
5. **Testing Environment Scope:** Automated test suites utilize mocked CLI adapters and isolated in-memory Redis interfaces. Verification did not include live external LLM provider account execution or distributed multi-node network fault injection.
6. **Frontend & Controller Layering:** Monolithic structures in `app/static/app.js` and thick business logic in `app/api/chat.py` and `app/api/openai.py` represent technical debt slated for modular refactoring in subsequent releases.

---

## 7. Conclusion

Revision `e0d9cd8` resolves every concrete P1-P3 finding recorded by the initial audit. With strict authentication boundaries, atomic quota reservation, fully asynchronous Redis communication, deterministic subprocess management, and non-root container packaging, Afaq Harness Gateway is release-ready for the verified single-node and Docker Compose deployment scope. The limitations in section 6 remain operator responsibilities for broader production environments.
