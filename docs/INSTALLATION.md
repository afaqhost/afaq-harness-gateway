# Installation

## Prerequisites

- Node.js 22 or later
- npm (bundled with Node.js)

No other global dependencies are required for the gateway itself. The four
Harness CLIs (command-code, codex, claude-code, opencode) are external tools
that must be installed and authenticated separately. See
[SUPPORTED_HARNESSES.md](SUPPORTED_HARNESSES.md).

## Install dependencies

```sh
npm ci
```

## Build

The project is written in TypeScript with ESM and uses NodeNext module
resolution. Source files import each other with `.js` extensions (e.g.
`./server.js`), which means native Node type-stripping alone is not sufficient
-- the `.js` specifiers would not resolve against the `.ts` source files. You
must compile before running:

```sh
npm run build
```

This runs `tsc -p tsconfig.build.json` and emits JavaScript into `dist/`.

## Run without Docker

After building:

```sh
npm start
```

This executes `node dist/src/start.js`.

### Environment variables

| Variable      | Default       | Description                              |
|---------------|---------------|------------------------------------------|
| `AHG_HOST`    | `127.0.0.1`  | Network address to bind                  |
| `AHG_PORT`    | `3000`        | Listening port                           |
| `AHG_DATA_DIR`| `.data`       | Directory for SQLite databases           |

Example:

```sh
AHG_PORT=8080 AHG_DATA_DIR=/var/lib/ahg npm start
```

## Run with Docker

A multi-stage `Dockerfile` is provided at the repository root. It builds the
project in a builder stage and copies the compiled output into a slim runtime
image.

```sh
docker build -t afaq-harness-gateway .
docker run -p 3000:3000 -v afaq-data:/data afaq-harness-gateway
```

The container sets `AHG_HOST=0.0.0.0`, `AHG_PORT=3000`, and
`AHG_DATA_DIR=/data` by default. Override with `-e` flags as needed.

A `.env.example` file documents the available variables. It contains no
secrets.

## Initial setup

On a fresh installation the gateway has no users. You must create the first
account before using any authenticated endpoint.

### 1. Create the admin user

```sh
curl -X POST http://127.0.0.1:3000/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme123"}'
```

The password must be at least 8 characters. This endpoint is disabled once any
user exists (returns 409).

### 2. Log in

```sh
curl -X POST http://127.0.0.1:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme123"}' \
  -c cookies.txt
```

The response sets an `ahg_session` cookie. The `-c` flag saves it for
subsequent requests.

### 3. Create an API key

```sh
curl -X POST http://127.0.0.1:3000/v1/keys \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"name":"my-key"}'
```

The response includes `full_key` -- this is the only time the full key is
shown. Store it securely. Use it as a Bearer token for `/v1/chat/completions`
and other API endpoints.

### 4. Test a completion

```sh
curl http://127.0.0.1:3000/v1/chat/completions \
  -H 'Authorization: Bearer ahg_live_...' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "command-code/deepseek/deepseek-v4-flash",
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

## Health check

```sh
curl http://127.0.0.1:3000/health
```

Returns `{"status":"ok"}` when all registered harness adapters are healthy, or
`{"status":"degraded","harnesses":{...}}` with per-adapter details when one or
more are unavailable.
