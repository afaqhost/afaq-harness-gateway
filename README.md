# Afaq Harness Gateway

Afaq Harness Gateway turns supported command-line AI tools into one local,
OpenAI-compatible API. Install and sign in to a harness CLI, start the gateway,
and applications can use that CLI through `GET /v1/models` and
`POST /v1/chat/completions`.

The project also includes a browser dashboard for conversations, harness
management, API keys, usage, users, and an administrator-only terminal.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Python: 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](requirements.txt)

## What you can do

- Connect one client to multiple AI harness CLIs through a consistent API.
- Use normal or streaming chat completions.
- Manage local conversations and API keys from a bilingual Arabic/English dashboard.
- Set per-key model access and daily or monthly quotas.
- Run with SQLite only, or add Redis for shared rate limits and stream history.
- Install supported npm-based harnesses from the dashboard using approved recipes.

This is a gateway, not an AI provider. You still need at least one supported CLI
installed and authenticated with its provider before chat requests can succeed.

## Start in five minutes

### Option 1: run locally

Requirements: Python 3.10 or newer, `pip`, `venv`, Git, and `curl`. Node.js and
npm are needed for JavaScript-based harness CLIs.

```bash
git clone <YOUR_FORK_OR_REPOSITORY_URL>
cd afaq-harness-gateway
make setup
make dev
```

When prompted, choose the native setup path. `make setup` checks prerequisites,
creates `.venv`, installs Python packages, creates `.env` with strong local
secrets, and prepares the data directories.

Open <http://127.0.0.1:3500/setup>. On the first run, the setup page creates the
administrator account and helps you install a harness. Later visits use
<http://127.0.0.1:3500/login>.

### Option 2: run with Docker

```bash
make setup ARGS="--path=docker"
docker compose up --build
```

Then open <http://127.0.0.1:3500/setup>. Compose exposes the gateway only on the
host loopback interface at port `3500`; Redis remains private to the Compose
network.

For a fully manual installation, troubleshooting, and non-interactive setup,
read [Installation and setup](docs/installation.md).

## Make your first API request

1. Install and authenticate at least one harness CLI.
2. In the dashboard, open **Harnesses** and refresh the model list.
3. Open **API Keys**, create a key, and copy it when shown. The raw key cannot be
   displayed again.
4. List the available model identifiers:

```bash
curl http://127.0.0.1:3500/v1/models
```

5. Copy an `id` from the response and send a completion request:

```bash
export AFAQ_API_KEY="afaq_REPLACE_WITH_YOUR_KEY"
export AFAQ_MODEL="REPLACE_WITH_AN_ID_FROM_V1_MODELS"

curl http://127.0.0.1:3500/v1/chat/completions \
  -H "Authorization: Bearer ${AFAQ_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${AFAQ_MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
```

`GET /v1/models` is public. `POST /v1/chat/completions` requires either an API
key or a dashboard JWT. API keys work only with `/v1/*`; they cannot access the
dashboard, administration APIs, or terminal.

## Supported harnesses

The registry includes custom adapters for Claude, Codex, OpenCode, Command Code,
Antigravity (`agy`), and Pi. Other registered CLIs use a generic text adapter.
Availability depends on which executables are installed on the machine or in
the container.

Always use the model identifiers returned by `/v1/models`; do not guess them.
See [Harness integrations](docs/harnesses.md) for the current registry,
installation notes, and the process for adding an adapter.

## Important security boundary

The dashboard contains an administrator-only OS terminal. A terminal session
runs with the same operating-system permissions as the gateway process. Keep the
service on a trusted machine, protect administrator credentials, and do not
publish port `3500` directly to the internet.

For a non-local deployment:

- keep `DEBUG=false`;
- use strong, unique `SECRET_KEY` and `CREDENTIALS_KEY` values;
- put TLS and authentication-aware access controls in front of the gateway;
- set `ALLOWED_ORIGINS` and `TRUSTED_PROXIES` explicitly;
- back up the SQLite database and its WAL sidecar files; and
- review [SECURITY.md](SECURITY.md) and the known limitations in
  [bugs&issues.md](bugs%26issues.md).

## Documentation

| Document | Use it for |
| --- | --- |
| [Installation](docs/installation.md) | Native, Docker, and manual setup |
| [Configuration](docs/configuration.md) | Environment variables and production settings |
| [API guide](docs/api.md) | Requests, streaming, errors, tools, and structured output |
| [Harnesses](docs/harnesses.md) | Supported CLIs and adapter development |
| [Architecture](docs/architecture.md) | Layers, request flow, persistence, and concurrency |
| [OS terminal](docs/os-terminal.md) | Terminal operation and security model |
| [Contributing](CONTRIBUTING.md) | Development workflow and pull requests |
| [Agent rules](AGENTS.md) | Repository-wide rules for humans and coding agents |

FastAPI also serves interactive API documentation at `/docs` and `/redoc` while
the gateway is running.

## Development quick start

```bash
make setup-fast
make check
make dev
```

`make check` compiles the Python package, validates the browser JavaScript, and
runs the complete test suite with warnings treated as errors. Tests use isolated
databases and fake harnesses; they do not require provider accounts or real CLI
binaries.

The main dependency direction is:

```text
HTTP route -> service -> repository or harness client -> database or CLI
```

New business logic belongs in `app/services/`, SQL and persistence queries in
`app/repositories/`, CLI behavior in `app/clients/`, and wire-level streaming
mechanics in `app/transport/`. Read [AGENTS.md](AGENTS.md) before changing code.

## Project layout

```text
app/
  api/             HTTP and WebSocket controllers
  services/        business rules and orchestration
  repositories/    database access
  clients/         harness CLI adapters
  transport/       SSE identity, replay, and heartbeat mechanics
  middleware/      rate limiting, request IDs, and logging
  shared/          dependency-light utilities
  static/          dashboard JavaScript, CSS, and images
  templates/       dashboard HTML
tests/
  unit/ integration/ contract/ security/ performance/ e2e/
docs/              operator and developer documentation
scripts/           setup and installation scripts
```

## Known limits

- Database schema changes do not yet use a migration framework.
- SQLite backups and disaster recovery are operator-managed.
- During a Redis outage, fallback history and rate-limit state are replica-local.
- The administrator terminal requires POSIX and is unavailable on Windows.
- Live provider accounts and multi-node network faults are outside the automated
  test suite.
- Some large controllers and the dashboard JavaScript still need incremental
  decomposition; new changes must not increase that coupling.

See [report.md](report.md) for the production-readiness review and
[bugs&issues.md](bugs%26issues.md) for the resolved findings and remaining debt.

## Contributing and license

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow
[AGENTS.md](AGENTS.md), and use the pull-request template. The project is
licensed under the [Apache License 2.0](LICENSE).
