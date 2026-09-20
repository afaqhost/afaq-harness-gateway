# Installation and Setup

## Prerequisites

- Python 3.12 or a compatible modern Python release.
- `pip` and virtual-environment support.
- Node.js and npm when installing JavaScript-based harness CLIs.
- At least one supported harness CLI installed and authenticated before sending chat requests.

The gateway itself can start without an installed harness, but `/v1/models` will list only installed harnesses.

## Local Installation

### One-command setup (recommended)

From the repository root:

```bash
make setup   # creates .venv, installs deps, generates .env with strong SECRET_KEY/CREDENTIALS_KEY, mkdir data/storage, init DB
make dev     # → http://127.0.0.1:3500/setup on first run, /login afterwards
```

On first run, open `http://127.0.0.1:3500/setup` — the **Setup Wizard** walks you through 3 steps:

1. **Create admin account** — email + display name + password (≥8 chars) → auto-login.
2. **Harnesses** — shows `opencode`, `codex`, `claude`, `commandcode` with installed flag and model counts; install any harness directly from the dashboard (*Install* runs the adapter's approved recipe — `npm install -g <package>`, or the official installer script for `agy` — **inside the container** with live SSE logs). On the host, run the command shown on the card manually and press *Refresh*.
3. **Ready** — go to chat or create API keys.

Check whether setup is needed without opening the browser:

```bash
make setup-status   # GET /api/auth/setup-status → {"needs_setup": true/false}
```

### Manual installation (alternative)

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
# secrets are auto-patched by make setup; or generate manually:
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
python -m uvicorn app.main:app --host localhost --port 3500
```

The dashboard is available at `http://127.0.0.1:3500/login` (or `/setup` on first run). FastAPI docs at `/docs` and `/redoc`.

## Create the First Administrator

You have two ways:

**A) Wizard (recommended, no curl):** Open `/setup` and fill the form — you are logged in automatically and redirected to the harnesses step.

**B) API / CLI (headless, CI):**

```bash
curl -X POST http://127.0.0.1:3500/api/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"REPLACE_WITH_A_STRONG_PASSWORD","display_name":"Admin"}'
# also available as:
make bootstrap EMAIL=admin@example.com PASS=StrongPass123 NAME=Admin
```

On success, `POST /api/auth/bootstrap` now returns `{"id", "email", "display_name", "role", "access_token", "token_type": "bearer", "user": {...}}` for auto-login (backward compatible: top-level `email`/`role` still present). A later request returns `409 Bootstrap already completed`. Check status with `GET /api/auth/setup-status`.

Sign in at `/login` with the same email and password, or use the token directly.

## Verify the Installation

```bash
curl http://127.0.0.1:3500/health
```

Expected response shape:

```json
{"status":"ok","service":"Afaq Harness Gateway","version":"0.1.0"}
```

After logging in, create an API key in the dashboard and use [api.md](api.md) to test an external request.

## Docker Compose

```bash
make setup   # generates .env with strong secrets if missing
docker compose up --build
# then open http://127.0.0.1:3500/setup — wizard will let you create admin + install harnesses inside container
```

The service is published as `http://127.0.0.1:3500` with a `HEALTHCHECK` (`/health`). A companion `redis:7-alpine` (64 MB, `allkeys-lru`) is included for optional multi-replica rate limiting / history / job mirroring — leave `REDIS_URL` empty to use the in-memory fallback. Named volumes persist the database, application storage, `/root/.npm` (so `npm install -g` inside the container survives restarts), and `/root/.local` (so the Antigravity script install survives restarts). The compose file no longer mounts `docker.sock` (do not re-add it in production).

Installing harnesses from the dashboard runs each adapter's approved recipe **inside the `afaq-gateway` container** via `app/clients/*` adapters — `npm install -g` (`opencode-ai`, `@openai/codex`, `@anthropic-ai/claude-code`, `command-code`) or the official Antigravity installer script (`agy`, binary → `/root/.local/bin`) — and streams logs via `GET /api/admin/harnesses/{name}/jobs/{id}/stream` (SSE, `event: log|done`). On the host you can also run `make install-agy` / `agy update`, or the npm command from `docs/harnesses.md`, then press *Refresh*.

## Stop and Restart

For a foreground local process, press `Ctrl+C`. Restart with the same Uvicorn command. Model discovery runs once during each server startup; use the dashboard's **Refresh models** action to refresh it without restarting.
