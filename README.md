# Afaq Harness Gateway

Afaq Harness Gateway is a local OpenAI-compatible gateway for command-line AI tools. It exposes a single HTTP API for chat completions and model discovery, while keeping each CLI integration behind a dedicated harness adapter.

## What It Provides

- OpenAI-compatible `GET /v1/models` and `POST /v1/chat/completions` endpoints.
- A bilingual Arabic/English dashboard at `/login` and the authenticated routes `/chat`, `/harnesses`, `/keys`, `/users`, and `/documentation`.
- JWT authentication for the dashboard and hashed, one-time-display API keys for external clients.
- Model discovery for installed harnesses, cached at server startup and refreshable from the Harnesses page.
- SQLite persistence for users, API keys, conversations, messages, harnesses, and usage records.
- Adapters for Codex CLI, OpenCode, Command Code, and Claude Code when the corresponding executable is installed.

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --host 0.0.0.0 --port 3500
```

Open `http://127.0.0.1:3500/login`. On a new database, create the first administrator with the bootstrap endpoint described in [docs/installation.md](docs/installation.md).

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
cp .env.example .env
docker compose up --build
```

The service listens on port `3500`. Compose persists `/app/data`, `/app/storage`, and the container's npm directory in named volumes. Harness CLIs still need to be installed and authenticated according to their official documentation; see [docs/harnesses.md](docs/harnesses.md).

## Development Checks

```bash
python -m compileall -q app
node --check app/static/app.js
AFAQ_EMAIL=admin@example.com AFAQ_PASSWORD='your-password' python test_api.py --skip-chat
```

The repository currently has no configured test runner. `test_api.py` is a smoke-test client, not a unit-test suite.

## Security Notes

- Never commit `.env`, API keys, the SQLite database, or local harness storage.
- API keys are hashed in the database and the raw value is returned only when the key is created.
- Change `SECRET_KEY` and `CREDENTIALS_KEY` before exposing the service beyond a trusted local network.
- Put a TLS-terminating reverse proxy in front of the service and restrict `ALLOWED_ORIGINS` for non-local deployments.

## License

Apache License 2.0. See [LICENSE](LICENSE).
