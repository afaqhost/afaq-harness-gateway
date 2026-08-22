# Afaq Harness Gateway

A self-hosted gateway that exposes an **OpenAI-compatible API** and routes
requests to local AI coding harness CLIs running in headless mode.

```text
Clients
  ↓
OpenAI-compatible API (/v1/chat/completions, streaming SSE)
  ↓
Afaq Harness Gateway
  ↓
Harness Adapter (spawns a local CLI process)
  ↓
Your Harness account / model provider
```

Afaq Harness Gateway owns normalized transport and lifecycle behavior. Each
Harness adapter owns only its own CLI-specific integration.

## Harnesses

| Adapter ID | CLI binary | Default model |
|---|---|---|
| `command-code` | `cmd` | `deepseek/deepseek-v4-flash` |
| `codex` | `codex` | `gpt-5.6-luna` |
| `claude-code` | `claude` | `claude-sonnet-4-6` |
| `opencode` | `opencode` | `opencode/mimo-v2.5-free` |

The four Harness CLIs are **external tools**. They are not bundled with this
project — you install and authenticate each one separately under its own
vendor's terms. Afaq's Apache-2.0 license does not grant rights to those
third-party services. See [docs/SUPPORTED_HARNESSES.md](docs/SUPPORTED_HARNESSES.md).

## Features

- OpenAI-compatible `/v1/chat/completions` (streaming and non-streaming)
- `/v1/models`, `/health`, `/v1/usage`, run inspection
- API-key authentication with per-key rate limits, concurrency limits, budgets,
  model allowlists, and expiry
- Session-based admin auth for key management
- Usage and estimated-cost tracking
- Persistent chat history and a lightweight web UI
- SQLite storage (WAL mode), in-process queue
- Minimal environment and `shell: false` process spawning for harness CLIs

## Requirements

- **Node.js 22.5 or later** (the runtime uses `node:sqlite`)
- npm (only needed to install dependencies and build)

There are **no runtime npm dependencies**. The compiled `dist/` directory runs
against Node.js built-ins only.

## Install from source

```sh
git clone <this-repository>
cd afaq-harness-gateway

npm ci          # install dev-only build/test dependencies
npm run build   # compile TypeScript into dist/
npm start       # run node dist/src/start.js
```

The server binds to `127.0.0.1:3000` by default and stores its SQLite data in
`./.data`.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AHG_HOST` | `127.0.0.1` | Address to bind |
| `AHG_PORT` | `3000` | Listening port |
| `AHG_DATA_DIR` | `.data` | Directory for SQLite databases |

```sh
AHG_HOST=0.0.0.0 AHG_PORT=8080 AHG_DATA_DIR=/var/lib/afaq npm start
```

`AHG_HOST=0.0.0.0` makes the service reachable from other hosts on your
network. Only expose it directly if it is already protected by a private
network or a firewall.

## First-time setup

On a fresh install there are no users. Create the first account, then log in
and create an API key:

```sh
# 1. Create the admin user (password must be at least 8 characters)
curl -X POST http://127.0.0.1:3000/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me-123"}'

# 2. Log in and save the session cookie
curl -X POST http://127.0.0.1:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me-123"}' \
  -c cookies.txt

# 3. Create an API key (the full key is shown only once)
curl -X POST http://127.0.0.1:3000/v1/keys \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"name":"default"}'

# 4. Use the key as a Bearer token
curl http://127.0.0.1:3000/v1/chat/completions \
  -H 'Authorization: Bearer ahg_live_...' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "command-code/deepseek/deepseek-v4-flash",
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

## Run with Docker

```sh
docker build -t afaq-harness-gateway .
docker run -p 3000:3000 -v afaq-data:/data afaq-harness-gateway
```

The image binds `0.0.0.0:3000` and persists data under `/data`.

## Where can I run it?

The gateway itself runs **anywhere Node.js 22.5+ runs** — a Linux VPS, bare
metal, a local machine, macOS, Windows, or ARM devices such as a Raspberry Pi
or NAS that have a compatible Node build.

Two practical deployment shapes:

1. **From source (dev-style host).** `npm ci && npm run build && npm start`.
2. **Compiled-only deploy.** Build on one machine, then copy just the `dist/`
   directory to the target server and run `node dist/src/start.js`. Because
   the runtime has no npm dependencies, the target only needs a Node binary —
   no `node_modules`, no npm install.

The real constraint is the **harness CLIs**, not the gateway. Each Harness you
want to use must be installed and authenticated on the same host that runs the
gateway, and those CLIs have their own operating-system and account
requirements. Install only the harnesses you actually use.

## Security

The gateway has **no built-in TLS**. In production, place it behind a private
network, a hardened HTTPS reverse proxy, Cloudflare Tunnel + Access, Tailscale,
or an equivalent. See [SECURITY.md](SECURITY.md) and the threat model in
`09-hardening/03_THREAT_MODEL.md`.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Supported Harnesses](docs/SUPPORTED_HARNESSES.md)
- [Compatibility & updates](docs/COMPATIBILITY.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Release notes](docs/RELEASE_NOTES.md)
- [Contributing](CONTRIBUTING.md)
- [Adapter contribution guide](docs/ADAPTER_CONTRIBUTION.md)

## License

Afaq Harness Gateway is licensed under the [Apache License 2.0](LICENSE).
Third-party notices are collected in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
