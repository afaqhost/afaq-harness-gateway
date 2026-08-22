# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Note:** Version 0.1.0 is the planned first public release. The
> `GATEWAY_VERSION` constant in `src/version.ts` currently reads `0.1.0`.
> No dated releases have been published yet.

## [Unreleased]

Nothing at this time.

## [0.1.0] -- Planned first public release

### Added

- OpenAI-compatible API (`/v1/chat/completions`, `/v1/models`, `/health`)
  with both streaming (SSE) and non-streaming responses.
- Four built-in Harness adapters: `command-code`, `codex`, `claude-code`,
  `opencode` -- each wrapping a local CLI binary with normalized event output.
- Streaming support with real-time SSE event framing and client disconnect
  handling.
- Authentication system: one-time `/auth/setup`, session-based `/auth/login`,
  and API-key management via `/v1/keys` (create, list, enable, disable,
  delete).
- Per-key rate limiting (RPM), concurrency limits, monthly budget caps, model
  allowlists, and expiration.
- Usage tracking and cost estimation via `/v1/usage` and per-run
  `estimated_cost_usd`.
- Conversation management (`/v1/conversations`) with persistent chat history
  in SQLite.
- Hermes integration (Hermes as a client, not a core dependency).
- Harness platform model with adapter registry, run service, and process
  runner.
- Installation and discovery system for harness CLI detection and version
  management.
- Credentials lifecycle with secure password hashing (scrypt) and session
  management.
- Updates and compatibility system with `VersionRange` model, safe-update
  gates, adapter contract testing, and post-update health checks.
- Tenant isolation guidance for managed deployment scenarios.
- Open-source release documentation: installation guide, supported harnesses,
  compatibility policy, release notes, and known limitations.
- Docker support with multi-stage build and `.env.example`.
- Web UI served at `/` for interactive chat.
- Structured JSON logging with request IDs.
- SQLite-backed persistence (WAL mode) for runs, auth, and chat data.
