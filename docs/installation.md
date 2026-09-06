# Installation and Setup

## Prerequisites

- Python 3.12 or a compatible modern Python release.
- `pip` and virtual-environment support.
- Node.js and npm when installing JavaScript-based harness CLIs.
- At least one supported harness CLI installed and authenticated before sending chat requests.

The gateway itself can start without an installed harness, but `/v1/models` will list only installed harnesses.

## Local Installation

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Start the service:

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 3500
```

The dashboard is available at `http://127.0.0.1:3500/login`. FastAPI's generated API documentation is available at `/docs` and `/redoc`.

## Create the First Administrator

Bootstrap is available only while the database has no users. Run this in a second terminal:

```bash
curl -X POST http://127.0.0.1:3500/api/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"REPLACE_WITH_A_STRONG_PASSWORD","display_name":"Admin"}'
```

A successful request creates an administrator. A later request returns `409 Bootstrap already completed`. Sign in at `/login` with the same email and password.

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
cp .env.example .env
# edit .env — set SECRET_KEY and CREDENTIALS_KEY (see docs/configuration.md)
docker compose up --build
```

The service is published as `http://127.0.0.1:3500` with a `HEALTHCHECK` (`curl /health`). A companion `redis:7-alpine` (64 MB, `allkeys-lru`) is included for optional multi-replica rate limiting / history / job mirroring — leave `REDIS_URL` empty to use the in-memory fallback. Named volumes persist the database, application storage, and `/root/.npm`. The compose file no longer mounts `docker.sock` (do not re-add it in production).

## Stop and Restart

For a foreground local process, press `Ctrl+C`. Restart with the same Uvicorn command. Model discovery runs once during each server startup; use the dashboard's **Refresh models** action to refresh it without restarting.
