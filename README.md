# Afaq Harness Gateway

Afaq Harness Gateway is a local OpenAI-compatible gateway for command-line AI tools. It exposes a single HTTP API for chat completions and model discovery, while keeping each CLI integration behind a dedicated harness adapter.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Tests: 204 passing](https://img.shields.io/badge/tests-204%20passing-brightgreen)](#development-checks)
[![Python: 3.12](https://img.shields.io/badge/python-3.12-blue)](requirements.txt)

## What It Provides

- **OpenAI-compatible** `GET /v1/models` and `POST /v1/chat/completions` (stream and non-stream, `tools`/`tool_choice`, `response_format` with one retry on `malformed_output`).
- **Dashboard** at `/login` and authenticated routes `/chat`, `/harnesses`, `/keys`, `/users`, `/usage`, `/documentation` — bilingual Arabic/English, searchable models, markdown rendering.
- **Auth:** JWT for dashboard + hashed, one-time-display API keys (`afaq_…`) for external clients; key rotation (`POST /keys/{id}/rotate`) with immediate revocation.
- **Persistence:** SQLite with WAL (`journal_mode=WAL`, 64 MB cache, 5 s busy timeout) — users, API keys, conversations (soft-delete + archive + restore), messages, harness state, credential profiles (Fernet-encrypted), usage records.
- **Harnesses:** adapters for Codex, OpenCode, Command Code, Claude (and generic fallback) — `is_installed`, `list_models`, queued `run`/`stream` with cancel, install/update jobs with SSE log streaming.
- **Realtime:** SSE with `event: start|token|usage|tool_call|tool_result|done|error|cancel|log`, `id:` + `retry:`, `Last-Event-ID` replay via `transport/history`, `: keepalive` heartbeats.
- **Production hardening:** per-bucket global rate limiting (in-memory or Redis), per-key `daily_limit`/`monthly_limit` + `allowed_models` enforcement, harness concurrency queue (`5` + 30 s wait → `429`), request IDs (`X-Request-ID`), structured JSON logs with redacted auth, sanitized harness errors, Prometheus `/metrics`, health checks.

## Quick Start

```bash
make setup          # interactive install wizard — detects missing tools, picks native or docker
make dev            # → http://127.0.0.1:3500/setup  (wizard on first run) or /login
```

The `make setup` install wizard detects missing prerequisites (Python, pip,
venv, node/npm, docker, redis, build tools) and lets you choose between a
**native install** (gateway runs on the host) or a **Docker** install
(gateway runs in a container). It installs whatever is missing for the
chosen path, then drops you at the dashboard.

For non-interactive / CI use:

```bash
make setup-fast                                 # native, no OS installs (assumes Python+git+curl)
make setup ARGS="--path=native --no-redis"      # native, skip redis install
make setup ARGS="--path=docker"                 # install docker if missing, run compose
make setup ARGS="--path=native --harness agy"   # also install the agy CLI
make setup-legacy                               # legacy scripts/setup.sh (no OS installs)
```

Run `bash scripts/install.sh --help` for the full flag list.

First dashboard run opens the **Setup Wizard** at `/setup` — create the admin
account (auto-login) and optionally install harnesses *inside the container*
via `npm` with live SSE logs. Subsequent runs go to `/login`. Manual
alternative:

```bash
python3 -m venv .venv && source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
# secrets are auto-patched by make setup; or generate manually:
python3 -c "import secrets; print(secrets.token_urlsafe(48))"  # -> SECRET_KEY / CREDENTIALS_KEY
python -m uvicorn app.main:app --host localhost --port 3500
```

Or via CLI without the wizard:

```bash
make bootstrap EMAIL=admin@example.com PASS=StrongPass123 NAME=Admin
```

## Documentation

- [Installation and setup](docs/installation.md)
- [Configuration reference](docs/configuration.md)
- [OpenAI-compatible API](docs/api.md)
- [Harness integrations](docs/harnesses.md)
- [Architecture](docs/architecture.md)

## External Client Example

Create an API key in the dashboard, then call the gateway from another project:

```bash
export AFAQ_BASE_URL="http://127.0.0.1:3500"
export AFAQ_API_KEY="afaq_YOUR_KEY"
python external_api_example.py
```

The client sends only `Authorization: Bearer <api-key>` to `/v1/chat/completions`; it does not use the dashboard login endpoint.

## Docker Compose

```bash
make setup          # generates .env with strong secrets if missing
docker compose up --build
# open http://127.0.0.1:3500/setup — wizard will let you create admin + install harnesses inside container
```

The service listens on port `3500` with a `HEALTHCHECK` (`/health`). Compose runs `redis:7-alpine` (64 MB, `allkeys-lru`) for rate limiting / history / job mirroring — fallback is in-memory when `REDIS_URL` is empty. It persists `/app/data`, `/app/storage`, and the container's npm directory (`/root/.npm`) in named volumes and no longer mounts `docker.sock`. Harness CLIs can be installed directly from the dashboard (*Harnesses → Install* or during the Setup Wizard) — `npm install -g <package>` runs inside the container with live SSE logs. On the host, run `npm install -g <package>` manually and press *Refresh*.

## Development Checks

```bash
make check          # compileall + node --check + pytest -q (204 tests, ~55s)
# or granular:
python -m compileall -q app
node --check app/static/app.js
.venv/bin/python -m pytest -q          # no external services required
# optional: Redis-backed mode
# REDIS_URL=redis://localhost:6379/0 REDIS_ENABLED=true .venv/bin/python -m pytest -q
make health         # curl /health
make setup-status   # check if bootstrap needed
```

## Project Structure (layered)

```
app/
  api/            # controllers — thin: parse request → call one service → shape response
  services/       # business logic (quota, harness jobs, queue, process registry)
  repositories/   # data access — only place that knows DB/SQL
  clients/        # outbound adapters — hide harness CLIs behind HarnessAdapter
  models/         # serializable data shapes (HarnessModel/HarnessResult)
  transport/      # SSE/history streaming mechanics
  config/         # composition root & settings (app/core/config.py facade)
  middleware/     # rate limiting, request IDs, structured logging
  shared/         # leaf utilities (no app imports)
```

`DESIGN.md` is the visual brand source of truth; `docs/architecture.md` is the code layer map.

## Security Notes

- Never commit `.env`, API keys, the SQLite database, or local harness storage (all ignored via `.gitignore`).
- API keys are SHA-256 hashed; the raw value is shown once at creation and on rotation. Use `POST /api/admin/keys/{id}/rotate`.
- `SECRET_KEY` / `CREDENTIALS_KEY` fail fast when weak and `DEBUG=false` (`app/core/config.py:63`). Generate with `secrets.token_urlsafe(48)`.
- All harness subprocess errors are sanitized (`app/shared/errors.py`) — raw `stderr` never leaks to clients.
- Put a TLS-terminating reverse proxy in front and restrict `ALLOWED_ORIGINS` for non-local deployments.
- See [SECURITY.md](SECURITY.md) for reporting and hardening, and [CONTRIBUTING.md](CONTRIBUTING.md) for the dev workflow.

## License

Apache License 2.0. See [LICENSE](LICENSE).
