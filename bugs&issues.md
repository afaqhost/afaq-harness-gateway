# Afaq Harness Gateway — Bugs and Issues

Review date: 2026-10-02  
Reviewed revision: `ca38352`  
Scope note: this is a current-codebase audit, not a regression-only diff review. Findings are concrete issues in the reviewed revision and are ordered by severity.

## Findings

### [P1] Restrict API keys from privileged dashboard and terminal routes — `app/api/auth.py:80`

`current_user` converts an API key into its owning `User`, and `admin_user` then authorizes solely from `user.role`. An API key owned by an administrator can therefore call every route guarded by `admin_user`, including `POST /api/admin/terminal/start`, which opens an interactive shell on the gateway host/container. This contradicts the documented JWT-for-dashboard/API-key-for-external-API boundary and turns leakage of an ordinary model-access key into full administrative shell access. Preserve credential type/scopes in the resolved identity and require JWT authentication for dashboard/admin/terminal routes.

Evidence path: `app/api/auth.py:80-94` → `app/api/os_terminal.py:44-59`.

### [P1] Reject the exact secrets shipped in `.env.example` — `app/core/config.py:51`

The production fail-fast list rejects shortened placeholder strings, but `.env.example` contains longer values ending in `-generate-with-secrets-token_urlsafe`. Those exact public values are not in `insecure_secrets`, so an operator who copies the example without running the installer starts successfully with a publicly known JWT signing key and credential-encryption key. This was reproduced by importing the application with `DEBUG=false` and the exact example values; the import printed `accepted-example-placeholders`. Reject the exact example values, enforce a minimum entropy/length policy, and add a regression test that loads `.env.example` unchanged.

Evidence path: `.env.example:5-6` and `app/core/config.py:47-55`.

### [P1] Bind Uvicorn to the container interface — `Dockerfile:15`

The image starts Uvicorn with `--host localhost`, while Compose publishes `3500:3500`. Inside a container, loopback binding accepts only connections originating in that container, so the health check can pass while users cannot reach the service through the published host port. Bind to `0.0.0.0` in the container (or override the command in Compose) and add a smoke test that curls the published port from the host/network namespace.

### [P1] Do not trust arbitrary `X-Forwarded-For` values for rate limiting — `app/middleware/rate_limit.py:194`

Unauthenticated callers can choose their rate-limit bucket by sending a different `X-Forwarded-For` value on each request because the middleware trusts the header regardless of whether the immediate peer is a configured reverse proxy. This makes global rate limiting trivial to bypass on any directly reachable deployment. Use the socket peer by default and process forwarded headers only through trusted-proxy middleware/configuration.

### [P2] Isolate OpenAI SSE replay history per stream — `app/api/openai.py:194`

Every OpenAI stream for a user writes to `history_key = f"openai:{user_id}"`, and every request starts event IDs at 1. Concurrent or sequential completions for the same user/API-key owner therefore share and interleave one replay buffer; reconnecting with `Last-Event-ID` can replay tokens and lifecycle events from a different completion. Introduce a stable client-visible stream/completion identifier and include it in the history key; add a concurrent two-stream isolation test.

### [P2] Drain subprocess stderr concurrently during streaming — `app/clients/base.py:378`

Streaming harnesses create both stdout and stderr pipes, but the loop reads only stdout and postpones reading stderr until after the process exits. A CLI that emits enough diagnostics to fill the stderr pipe blocks on its next stderr write, which can halt stdout and force a false 90-second timeout. Run a concurrent stderr-drain task (with a bounded buffer) for the entire process lifetime and include its tail in terminal error reporting.

Evidence path: `app/clients/base.py:378-383`, `app/clients/base.py:411-449`.

### [P2] Make API-key quota admission atomic — `app/services/quota_service.py:28`

Quota enforcement counts existing usage records before starting a harness, while the new usage record is written only after the request completes. Two concurrent requests at a limit boundary can both observe the same count and both proceed—for example, two requests can pass a daily limit of one. Reserve quota atomically before dispatch (transactional counter/row lock or Redis script) and reconcile the reservation on completion/failure.

### [P2] Remove synchronous Redis I/O from async request and streaming paths — `app/transport/history.py:54`

SSE history, model cache, and harness-job mirroring use the synchronous Redis client from async code. Streaming writes perform blocking `LPUSH`/`LTRIM`/`EXPIRE` operations for each event, while model-cache reads and job updates also construct clients and call `PING` synchronously. A slow Redis server can block the event loop and stall unrelated requests. Use shared `redis.asyncio` clients with explicit connect/socket timeouts and pipeline the per-event history operations.

Related paths: `app/transport/history.py:54-119`, `app/clients/registry.py:133-247`, `app/services/harness_job_service.py:43-56`.

### [P3] Reject login for inactive users — `app/api/auth.py:140`

The login endpoint verifies email and password but does not check `user.is_active`, so it returns a successful response and JWT for a disabled account. Subsequent protected requests reject the token, producing a confusing login-success/immediate-401 flow and exposing account/password validity. Include `user.is_active` in the login condition and test the disabled-user login case.

### [P3] Await or remove Redis reset cleanup tasks — `app/middleware/rate_limit.py:101`

`RedisRateLimiter.reset()` schedules `flushdb()` with `asyncio.create_task()` but exposes no way to await it. The test fixture calls this before and after every test, and the full suite emitted hundreds of `Redis.execute_command was never awaited` warnings as event loops closed with pending cleanup. Make reset async and await it, or provide a synchronous test-only reset that does not create orphan tasks. Avoid `FLUSHDB` against a shared production Redis database.

### [P3] Align documented test counts with the actual suite — `README.md:7`

The README badge/development section and Makefile describe 204 tests, while the current suite passes 237. This makes release evidence stale and is likely to keep drifting if counts are maintained manually. Remove the hard-coded count or generate it in CI.

## Test and residual-risk summary

Validation completed:

- `python -m compileall -q app`: passed.
- `node --check app/static/app.js`: passed.
- `.venv/bin/python -m pytest -q`: **237 passed** in 66.12 seconds.
- Warnings: **481**, dominated by un-awaited Redis cleanup coroutines; one subprocess transport was also finalized after its event loop closed.

High-value missing regression tests:

- Admin-owned API key rejected from terminal/admin routes.
- Exact `.env.example` values rejected in production mode.
- Docker published-port reachability.
- Forged `X-Forwarded-For` does not create a new bucket unless the peer is trusted.
- Two simultaneous OpenAI streams for one user cannot replay each other's events.
- Streaming adapter remains live when stderr exceeds the OS pipe buffer.
- Concurrent requests cannot exceed a quota of one.
- Disabled users cannot log in.

## Overall assessment

The test suite provides good functional confidence, but it currently misses credential-scope, deployment, concurrency, and backpressure failures. The four P1 security/deployment issues should be treated as release blockers for any network-exposed or containerized deployment. The P2 items are important reliability and correctness work, especially for Redis-enabled or concurrent usage.
