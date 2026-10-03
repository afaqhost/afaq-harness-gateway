# Changelog

All notable changes to Afaq Harness Gateway are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-beta.1] - 2026-10-04

### Added
- Dashboard links to the GitHub Releases page and repository issue chooser.
- Complete administrator user management: create, edit, reset password, change role, activate/deactivate, and delete with owned-data cleanup and self-lockout protection.
- **OpenAI-Compatible Gateway:** Standardized `/v1/models` and `/v1/chat/completions` supporting streaming (SSE), JSON schema structured output validation, and function/tool calling.
- **Harness CLI Adapters:** Extensible adapter architecture supporting Claude Code, OpenAI Codex, OpenCode, Command Code, Google Antigravity (`agy`), Pi, and generic command-line models.
- **Bilingual Web Dashboard:** Arabic and English web interface for chat, model browsing, API key management with immediate rotation, and encrypted credential storage.
- **Admin OS Terminal:** Browser-based interactive POSIX login shell powered by WebSocket communication and server-side PTY management.
- **Atomic Quota System:** Two-phase quota reservation (`QuotaReservation`) with transactional admission control and durable usage tracking (`UsageRecord`).
- **Stream Identity Scoping:** Collision-free SSE reconnection and replay buffering scoped per stream identity (`StreamIdentity`), user, and resource.
- **Asynchronous Redis Provider:** Centralized connection-pooled `redis.asyncio` provider with bounded 2.0-second timeouts, pipelined history operations, and local shadow bucket rate limiting.
- **Hardened Container Deployment:** Docker image running as the unprivileged `node` user and listening on `0.0.0.0:3500`, paired with Docker Compose publishing strictly to `127.0.0.1:3500` and isolating Redis on an internal network.

### Security & Hardening
- **Authentication Boundary Separation:** Partitioned credentials so that API keys (`afaq_...`) are limited to `/v1/*` OpenAI endpoints; protected dashboard, `/api/*`, and `/terminal` routes require signed JWTs, with public auth/setup endpoints retained.
- **Inactive User Enforcement:** Login rejects inactive accounts (`is_active=False`) immediately without issuing tokens.
- **Production Secret Validation:** Enforced fail-fast validation when `DEBUG=false`, rejecting empty secrets, weak strings, values shorter than 32 characters, and `.env.example` placeholders.
- **Trusted Proxy Filtering:** `RateLimitMiddleware` enforces socket-peer address resolution by default and parses `X-Forwarded-For` headers only from configured `TRUSTED_PROXIES`.
- **Direct Bcrypt Integration:** Migrated from legacy hashing wrappers to direct `bcrypt` hashing with an explicit 72-byte UTF-8 ceiling (`BCRYPT_MAX_PASSWORD_BYTES = 72`) to eliminate silent truncation.
- **Multithread-Safe PTY Spawning:** Replaced `pty.fork()` with `os.openpty()` + `os.posix_spawn()` and a dedicated child process wrapper (`app.services.os_terminal_child`), preventing fork deadlocks in multi-threaded Uvicorn runtimes.
- **Deterministic Subprocess & Pipe Cleanup:** Implemented `communicate_with_timeout` and concurrent bounded stderr draining (`_BoundedStderrDrainer`) to prevent OS pipe buffer deadlocks and leaked file descriptors.
- **Clean Quality Gates:** Warning-free automated test suite passing 331 tests under `pytest -W error`.
