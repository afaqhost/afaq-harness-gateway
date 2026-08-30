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

## Main Components

| Component | Responsibility |
| --- | --- |
| `app/main.py` | FastAPI application, lifecycle startup, static files, templates, and page routes |
| `app/api/auth.py` | Bootstrap, login, JWT validation, and user dependencies |
| `app/api/openai.py` | Model listing and OpenAI-compatible chat completions |
| `app/api/admin.py` | Harness status, model refresh, users, and API keys |
| `app/harnesses/registry.py` | Adapter contracts, CLI commands, output parsers, and model cache |
| `app/db/database.py` | SQLAlchemy models, SQLite engine, and database initialization |
| `app/static/` and `app/templates/` | Bilingual dashboard assets |

## Authentication Boundaries

Dashboard requests use a JWT returned by `POST /api/auth/login`. External OpenAI-compatible requests use an API key created through `POST /api/admin/keys`. The chat endpoint accepts either credential type, while API-key usage is recorded against the key when applicable.

## Model Cache

`refresh_models()` populates the in-memory model cache during FastAPI startup. `GET /v1/models` and `GET /api/admin/harnesses` read the cache and do not invoke CLI discovery. `POST /api/admin/harnesses/refresh`, used by the dashboard refresh button, rebuilds the cache.

## Model Identifiers

The public format is `harness//model` when no separate provider is used. OpenCode models preserve their provider/model value after the harness prefix, for example `opencode//opencode/big-pickle`. The API removes the harness prefix before passing the model value to the adapter.

## Persistence

SQLite stores users, hashed API keys, conversations, messages, harness records, and usage records. The default database is `data/afaq.db`; configure another SQLAlchemy async URL with `DATABASE_URL`.

## Current Boundaries

Harness installation endpoints currently return an accepted message for the next UI integration rather than running an installation job. A production installation workflow should add a job manager, durable job status, an allow-listed command policy, and streaming progress events.
