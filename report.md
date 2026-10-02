# Afaq Harness Gateway — Project and Architecture Review

Review date: 2026-10-02  
Reviewed revision: `ca38352` (`main`, aligned with `origin/main`)  
Repository state at review start: clean  
Review scope: application source, tests, deployment files, installers, documentation, and the existing Graphify knowledge graph

## Executive summary

Afaq Harness Gateway is a well-tested, local-first FastAPI gateway that normalizes multiple AI command-line tools behind OpenAI-style HTTP and SSE APIs. Its strongest architectural idea is the `HarnessAdapter` boundary: controllers and services work with one adapter contract while each external CLI owns its command construction and output parsing. The system also has useful operational features—SQLite WAL persistence, encrypted credential profiles, request quotas, rate limiting, subprocess cancellation, SSE replay, Redis-backed coordination, metrics, and a privileged browser terminal.

The implementation is a layered modular monolith, but the documented boundaries are only partially enforced. Several controllers still contain business rules and direct SQLAlchemy operations, configuration remains physically owned by `app/core/config.py` despite the advertised `app/config/settings.py` direction, and synchronous Redis calls appear in async request/stream paths. The browser frontend is also a large single-file application.

The automated suite is broad and currently passes: **237 tests passed** across unit, integration, contract, security, performance, and end-to-end groups. However, the run produced **481 warnings**, mainly un-awaited Redis cleanup coroutines, plus a leaked subprocess transport warning. More importantly, the suite does not cover several high-risk boundaries identified in this review. Detailed findings are in `bugs&issues.md`.

Overall assessment: the project has a solid product skeleton and good functional coverage, but it is not ready to be described as production-hardened until the authentication boundary, secret validation, and container networking defects are fixed.

## System purpose

The gateway exposes local AI harness CLIs through a single service:

```text
HTTP/SSE client or browser dashboard
  -> FastAPI middleware
  -> authentication and authorization
  -> API controller
  -> model/quota/credential services
  -> HarnessAdapter registry
  -> external CLI subprocess
  -> normalized response or SSE stream
  -> SQLite usage/conversation persistence
```

Primary external interfaces:

- OpenAI-style API: `GET /v1/models`, `POST /v1/chat/completions`, stream cancellation.
- Dashboard API: authentication, conversations, usage, keys, users, credentials, and harness management.
- Admin terminal: REST lifecycle endpoints plus a WebSocket-backed POSIX PTY.
- Operations: `/health`, `/metrics`, request IDs, structured logs, Docker Compose, and setup scripts.

## Architecture map

| Layer | Main paths | Actual responsibility | Review notes |
| --- | --- | --- | --- |
| Composition/application | `app/main.py` | FastAPI construction, lifespan, middleware, routers, static/dashboard routes | Clear composition point, although startup performs DB, credential, Redis, and CLI discovery work serially. |
| Inbound controllers | `app/api/*` | HTTP/WebSocket validation, auth dependencies, response shaping, SSE orchestration | Several modules are thick: `chat.py` is 542 lines and `openai.py` is 430 lines; both contain persistence and business workflow code. |
| Business services | `app/services/*` | model policy, credentials, quota, harness jobs/queue, process registry, PTY lifecycle | Useful separation exists, but controllers bypass it frequently and import ORM models directly. |
| Persistence | `app/db/database.py`, `app/repositories/*` | SQLAlchemy engine/models and selected repository operations | SQLite is configured with WAL and foreign keys. Repository extraction is incomplete; many controller queries remain inline. |
| Outbound adapters | `app/clients/*` | CLI discovery, command construction, subprocess execution, parsing | `HarnessAdapter` is the core abstraction. Base execution behavior is shared effectively, but one base-class streaming defect affects every adapter. |
| Transport | `app/transport/*` | SSE history, replay, heartbeat, disconnect handling | Good extraction from controllers, but replay identity is too coarse for OpenAI streams. |
| Middleware | `app/middleware/*` | request ID, logging, and rate limiting | Small and understandable. Proxy trust is not configured safely. |
| Shared utilities | `app/shared/*` | errors, model parsing, prompts, SSE formatting, schemas, time | Mostly cohesive leaf utilities. |
| Browser UI | `app/templates`, `app/static` | bilingual dashboard and terminal | Functional but highly centralized: `app.js` is 2,101 lines and `app.css` is 2,718 lines. |

## Core runtime flows

### OpenAI chat completion

1. `RateLimitMiddleware` creates a bucket from the authorization header or client address.
2. `app/api/openai.py` resolves a JWT or API key and enforces API-key quota/model restrictions.
3. `model_service` parses and validates `harness//model` identifiers.
4. `clients.registry` returns the selected `HarnessAdapter`.
5. `credential_service` decrypts the user's selected token and maps it to a harness environment variable.
6. The adapter creates a subprocess under a request-specific working directory and registers it for cancellation.
7. Non-stream responses are normalized into an OpenAI response and persisted as usage records.
8. Stream responses pass through `pump_harness_stream`, emit heartbeat/lifecycle events, store replay history, and record usage after completion.

### Dashboard conversation

1. `current_user` resolves the caller and conversation repository helpers enforce ownership.
2. User messages are persisted before invoking a harness.
3. The entire conversation history is transformed into a CLI prompt.
4. The adapter runs or streams the model response.
5. Assistant output and usage are committed, with a separate session for streaming completion.

### Harness lifecycle

1. Admin endpoints resolve an adapter and validate an install recipe.
2. `HarnessJobService` launches installation/update work in a background task.
3. Logs and state are held in memory and mirrored to Redis when configured.
4. SSE polling exposes job logs.
5. Successful jobs trigger a complete model-cache refresh.

### OS terminal

1. An admin creates a PTY session through the REST API.
2. `OsTerminalService` forks a login shell and tracks ownership in memory.
3. A WebSocket authenticates the user, then pumps PTY input/output bidirectionally.
4. Disconnect or explicit stop terminates the shell session.

## Data architecture

The SQLAlchemy model is compact and appropriate for the present scale:

- `User`: dashboard identity and role.
- `APIKey`: hashed external credential, activation state, quotas, and allowed models.
- `Harness`: cached install/authentication state.
- `CredentialProfile`: per-user, per-harness encrypted token/profile state.
- `Conversation` and `Message`: user-owned chat history with archive and soft-delete state.
- `UsageRecord`: per-request accounting, latency, status, and cost fields.

Positive characteristics:

- API keys are stored as SHA-256 digests, not raw values.
- Credential tokens are encrypted with Fernet using a derived credentials key.
- SQLite foreign keys and WAL are enabled.
- Conversation and credential queries generally verify user ownership.

Limitations:

- Schema creation uses `Base.metadata.create_all`; there is no migration mechanism for deployed schema evolution.
- SQLite is the only exercised database despite documentation suggesting a future PostgreSQL URL.
- Quota enforcement is a read-then-later-write workflow and is not concurrency-safe.
- Most timestamps are naive UTC values, making future multi-time-zone or PostgreSQL migration more error-prone.

## External integration architecture

`HarnessAdapter` centralizes:

- installation and update command recipes;
- executable discovery;
- per-request working directories;
- environment injection;
- concurrency limiting;
- process registration/cancellation;
- timeouts;
- streaming and non-stream output parsing.

Concrete adapters cover Claude, Codex, OpenCode, Command Code, Antigravity, Pi, and multiple generic CLIs. This is the project's best extension point. New adapters can be added in `app/clients/registry.py` without changing the public APIs.

The main architectural risk is that all adapters inherit the same subprocess streaming implementation. A defect in stderr draining or cancellation therefore affects every streaming harness.

## Security boundaries

Intended boundary, based on project documentation:

- JWT: dashboard session and administrative functions.
- API key: external OpenAI-compatible access, subject to key quotas/model restrictions.
- Encrypted credential profile: secret passed only to the chosen harness subprocess.

Actual boundary:

- `current_user` accepts both JWTs and API keys and is reused by dashboard routes.
- `admin_user` checks only the resolved user's role, not whether the credential is a JWT.
- Consequently, an API key owned by an admin becomes a full dashboard/admin credential, including access to the host terminal.

This mismatch is the most serious architectural issue in the project. Authentication should return an identity that preserves credential type and scopes, and route dependencies should declare which credential classes they accept.

Other security observations:

- Production secret checks exist but do not reject the exact values shipped in `.env.example`.
- Proxy headers are trusted without a trusted-proxy configuration.
- The admin terminal intentionally grants host/container shell access and therefore requires the strongest authentication boundary in the application.
- CORS defaults are restricted to local origins, which is preferable to a wildcard.
- Harness errors are sanitized before being returned to clients.

## Concurrency and distributed behavior

Per-process coordination:

- Harness concurrency is controlled by an `asyncio.Semaphore`.
- Active subprocesses and terminal sessions are stored in process memory.
- Without Redis, rate-limit state, SSE replay, job state, and model cache are replica-local.

Redis-backed coordination:

- Rate limiting uses the async Redis client.
- Model cache, harness jobs, and SSE history use synchronous Redis clients from async paths.
- Repeated client construction and `PING` calls add avoidable latency and can block the event loop during Redis/network stalls.

The current design is best treated as single-replica unless Redis interactions are consolidated behind long-lived async clients and process-local state limitations are documented.

## Deployment and operations

Deployment assets include a Dockerfile, Docker Compose stack, native setup scripts, health check, Redis service, and persistent volumes.

Important observations:

- The Dockerfile starts Uvicorn with `--host localhost`; Compose publishes port 3500, but traffic from the host cannot reach a process bound only to container loopback.
- The image runs as root. This is especially consequential because the application exposes an admin PTY and can install global CLI packages.
- Docker dependencies are fully pinned at the Python package version level, improving reproducibility.
- GitHub Actions runs Python 3.12 compilation, the JavaScript syntax check, and pytest on pushes and pull requests to `main`; it does not build or smoke-test the container.
- No database backup/restore or migration workflow is implemented.

## Testing assessment

Executed checks:

```text
Python bytecode compilation: passed
JavaScript syntax check: passed
pytest: 237 passed in 66.12 seconds
warnings: 481
```

Test strengths:

- Good spread across unit, integration, contract, security, performance, and end-to-end tests.
- Conversation ownership, API contracts, model restrictions, cancellation, SSE heartbeat/reconnect, credential encryption, and terminal isolation have explicit coverage.
- External CLIs are abstracted with fake adapters so most tests do not require network services.

Material gaps:

- No assertion that API keys are rejected from dashboard/admin/terminal routes.
- No test against the exact `.env.example` placeholder values.
- No container reachability smoke test.
- No concurrent quota test.
- No concurrent same-user OpenAI stream replay isolation test.
- No streaming subprocess test that fills stderr.
- No trusted-proxy/rate-limit spoofing test.
- Redis cleanup emits un-awaited-coroutine warnings in nearly every test.

## Maintainability assessment

The backend's naming and module responsibilities are generally understandable. The main maintainability concern is uneven layering:

- `app/api/chat.py`, `app/api/openai.py`, and `app/api/admin.py` combine controller, orchestration, business policy, and persistence.
- `app/config/settings.py` claims to be canonical but re-exports the implementation from `app/core/config.py`; the documented dependency direction is reversed.
- `app/domain/harness.py` and `app/application/chat_service.py` are seams used mostly by unit tests rather than the production request path.
- The frontend has no component/module boundary and will become increasingly difficult to change safely.
- Documentation references 204 tests, while the current suite collects and passes 237.

Recommended architecture direction:

1. Split authentication into JWT-only, API-key-only, and explicitly combined dependencies with credential type/scopes preserved.
2. Move chat completion and conversation-send workflows into application services; keep controllers limited to HTTP concerns.
3. Make `app/config/settings.py` the real implementation and retain `app/core/config.py` only as a compatibility re-export.
4. Consolidate Redis access in one async infrastructure module with a shared connection pool and explicit timeouts.
5. Add Alembic migrations before the next schema change.
6. Break the dashboard JavaScript into API, state, chat, admin, terminal, and i18n modules.
7. Extend the existing CI checks with a container build and published-port reachability smoke test.

## Prioritized next actions

1. Fix all P1 findings in `bugs&issues.md` before exposing the service beyond a trusted local machine.
2. Add regression tests for every P1/P2 finding.
3. Remove synchronous Redis operations from async request and stream paths.
4. Make quota reservation atomic and ensure streaming usage is recorded before or independently of the final client-visible event.
5. Introduce schema migrations and CI enforcement.
6. Update README/Makefile test counts and document the true single- versus multi-replica guarantees.

## Review limitations

- External harness CLIs were not invoked against live provider accounts.
- Redis-backed behavior was inspected and exercised indirectly through the suite, but no live Redis integration environment was used.
- The Docker image was inspected statically; no container was launched during this review.
- The existing knowledge graph was used as an architectural index, but all conclusions in this report were cross-checked against source code.
