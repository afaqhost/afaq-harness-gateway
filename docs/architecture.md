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

## Layer Map (target: controller → service → repository/client)

| Layer | Location | Rule |
| --- | --- | --- |
| `controllers` (inbound) | `app/api/*` | Thin: parse request → call **one** service → shape response. No business rules, no SQL. |
| `services` | `app/services/*` | Business verbs: `quota_service`, `harness_job_service`, `harness_queue`, `process_registry`, `model_service`, `credential_service`. Depend on interfaces, never on HTTP/SQL. |
| `repositories` | `app/repositories/*` + `app/db/database.py` ORM | Only place that knows DB/SQL. `conversation_repository`, `usage_repository`. |
| `clients` (outbound) | `app/clients/*` | Hide harness CLIs behind `HarnessAdapter` (`base.py`). Registry + `MODEL_CACHE` in `clients/registry.py` (with Redis mirror). |
| `models` | `app/models/harness.py` | Serializable shapes `HarnessModel`/`HarnessResult` (single source; split DTO only when wire shape differs). |
| `transport` | `app/transport/*` | Wire mechanics: `history.py` (SSE replay, Redis fallback) + `stream.py` (heartbeat). No business meaning. |
| `config` | `app/config/settings.py` (facade `app/core/config.py`) | Env + DI composition root. |
| `middleware` | `app/middleware/*` | `rate_limit` (Redis/in-memory), `request_id`, `logging` (JSON, redacted). |
| `shared` | `app/shared/*` | Leaf utilities (`model_utils`, `prompt_utils`, `sse`, `time`, `errors`, `structured_output`) — no app imports. |

`app/domain/harness.py` exposes `HarnessPort` Protocol + `ChatService` (used by unit tests; controllers currently resolve via `clients/registry.get_adapter` — deliberate seam for future DIP injection). `app/harnesses/registry.py` is a backwards-compatible facade re-exporting `app/clients/*`.

## Main Components

| Component | Responsibility |
| --- | --- |
| `app/main.py` | FastAPI app, lifespan (`init_db` → `harvest_env_credentials` → `refresh_models`), exception → `error_payload` mapping, page routes, health |
| `app/api/auth.py` | Bootstrap, login, JWT + API-key `current_user` (with `last_used_at` update) |
| `app/api/openai.py` | `GET /v1/models`, `POST /v1/chat/completions` (tools, response_format, SSE `event:`/`id:`/`retry:`, `Last-Event-ID` replay, cancel) |
| `app/api/chat.py` | Dashboard conversations/messages (CRUD, soft-delete/restore, search, pagination), streaming with heartbeat + cancel |
| `app/api/admin.py` | Harness status/health, `refresh`, `install`/`update` jobs (allow-listed `npm install -g`), users, keys + rotation |
| `app/api/credentials.py` | Credential profiles (encrypted, per-harness `profile_name`, `check` → `status`) |
| `app/api/usage.py` | Filtered usage listing (`from`/`to`, harness/model, pagination) |
| `app/api/metrics.py` | Prometheus `/metrics` (or `501` when client not installed) |
| `app/clients/*` | `HarnessAdapter` + concrete `Claude/Codex/OpenCode/CommandCode/Generic` + queued `run`/`stream` |
| `app/db/database.py` + `app/repositories/*` | SQLite WAL engine, models (`User`, `APIKey`, `Harness`, `CredentialProfile`, `Conversation`, `Message`, `UsageRecord`), queries |
| `app/static/` + `app/templates/` | Bilingual dashboard |

## Authentication Boundaries

Dashboard requests use a JWT returned by `POST /api/auth/login`. External OpenAI-compatible requests use an API key created through `POST /api/admin/keys`. The chat endpoint accepts either credential type, while API-key usage is recorded against the key when applicable.

## Model Cache

`refresh_models()` populates the in-memory model cache during FastAPI startup. `GET /v1/models` and `GET /api/admin/harnesses` read the cache and do not invoke CLI discovery. `POST /api/admin/harnesses/refresh`, used by the dashboard refresh button, rebuilds the cache.

## Model Identifiers

The public format is `harness//model` when no separate provider is used. OpenCode models preserve their provider/model value after the harness prefix, for example `opencode//opencode/big-pickle`. The API removes the harness prefix before passing the model value to the adapter.

## Persistence

SQLite (WAL: `journal_mode=WAL`, `synchronous=NORMAL`, 64 MB cache, 5 s `busy_timeout` in `app/db/database.py:13`) stores users, hashed API keys, conversations (with `archived`/`deleted_at` + restore), messages, harness records (`last_checked_at`), credential profiles, and usage records. The default is `data/afaq.db`; override with `DATABASE_URL` (e.g., `postgresql+asyncpg` when `database is locked` appears — repositories are already isolated).

## Current Boundaries & Recent Hardening

- **Jobs:** `POST /harnesses/{name}/install` / `update` now create a `HarnessJob` (`app/services/harness_job_service.py`) with allow-listed `npm install -g` check, background `adapter.install()` streaming, Redis mirror + TTL, and `GET /jobs/{id}` + `/jobs/{id}/stream` (`event: log/done`).
- **Credentials:** `app/services/credential_service.py` encrypts tokens via `app/core/security.encrypt_secret` (Fernet derived from `CREDENTIALS_KEY`) and injects per-harness env (`ANTHROPIC_API_KEY`, etc.) at `run`/`stream` time; `lifespan` harvests `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/… into default profiles for the first admin.
- **Queue & backpressure:** `app/services/harness_queue.py` (`Semaphore(5)`, 30 s wait → `429`) wraps `HarnessAdapter.run/stream` so 512 MB hosts handle 20+ concurrent callers without OOM.
- **Streaming:** `transport/history` + `transport/stream` own `id:`/`retry:`/`Last-Event-ID` replay and `: keepalive`; controllers emit `start|token|usage|tool_call|tool_result|done|error|cancel` with `X-Request-ID` / `X-RateLimit-Limit`.
- **Observability:** structured JSON logs (`request_id`, redacted `authorization`), `X-Request-ID` echo, sanitized `harness_error` (`app/shared/errors.py`), Prometheus at `/metrics`, and fast `/health` (no `list_models` call).
