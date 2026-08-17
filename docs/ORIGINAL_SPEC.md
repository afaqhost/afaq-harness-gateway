# Afaq Harness Gateway — English Master Specification

## 1. Executive Summary

Afaq Harness Gateway is a self-hosted internal gateway that exposes an OpenAI-compatible API and a lightweight Admin/Chat UI, then routes requests to local AI coding harnesses running in headless CLI mode.

Typical flow:

```text
Client -> OpenAI-compatible API -> Afaq Gateway -> Harness CLI -> Account/Model
```

Supported clients may include Hermes, Telegram through Hermes, n8n, internal applications, a web Chat UI, curl, and any OpenAI SDK-compatible client.

The gateway is not a public SaaS, billing platform, or subscription product in the MVP. It is intended for the project owner and a small team.

## 2. Core Concepts

### Provider

An inference provider such as OpenAI, Anthropic, Google, OpenRouter, or Ollama.

### Harness

A CLI/agent runtime that can use models and tools, such as Command-Code, Codex CLI, Claude Code, or OpenCode.

### Adapter

The integration layer that converts the gateway's normalized request into harness-specific CLI arguments, executes the process, parses its output, and emits normalized events.

### Model ID

Use:

```text
<harness>/<provider>/<model>
```

or, when the provider is implicit:

```text
<harness>/<model>
```

Examples:

```text
command-code/google/gemini-3.7-flash
codex/gpt-5
claude-code/claude-sonnet-4-6
opencode/anthropic/claude-sonnet-4-6
```

Aliases resolve to canonical model IDs before execution.

## 3. User Experience

### Hermes

Hermes is configured with an OpenAI-compatible custom endpoint, API key, and Afaq model ID. Hermes does not need to know whether the backend is a CLI harness.

### Web Chat

The user chooses Harness/Provider/Model, sends a message, receives a streaming response, and can inspect run metadata such as duration, usage, and estimated cost.

### External API

Expose at minimum:

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
```

`stream=true` must produce OpenAI-compatible SSE.

## 4. Architecture

```text
Clients
  |
  | OpenAI-compatible HTTP/SSE
  v
+-------------------------------------+
| Afaq Harness Gateway               |
|                                     |
| Admin + Chat UI                     |
| API routes                          |
| Auth / API keys / limits            |
| Model registry / aliases            |
| Usage / estimated cost              |
| Run service / queue                 |
| Harness registry + adapters         |
+------------------+------------------+
                   |
                   | spawn CLI process
                   v
+-------------------------------------+
| Local Harness CLIs                  |
| Command-Code / Codex / Claude / ...|
+------------------+------------------+
                   |
                   v
          Accounts / Model Providers
```

The core runtime must not contain harness-specific parsing logic.

## 5. Adapter Contract

The common contract is defined in `contracts/HARNESS_ADAPTER.md`.

Each adapter must implement:

- health checks;
- model listing;
- execution;
- event streaming;
- cancellation.

The normalized event types are `started`, `text_delta`, `tool_started`, `tool_finished`, `usage`, `completed`, and `failed`.

## 6. Command-Code Adapter

Command-Code is the first production adapter. Its exact CLI syntax must be verified against the installed version instead of copied from assumptions.

The adapter should support:

- headless execution;
- JSON/NDJSON parsing;
- safe argument construction;
- timeouts;
- cancellation;
- final text and usage extraction when available;
- deterministic parser fixtures.

The gateway Chat UI should remain read-only with respect to project workspaces in the MVP. Do not expose arbitrary write-enabled CLI flags through the public Chat API.

## 7. Session and Chat Memory

Chat history is stored in the gateway database. A native harness session ID may be stored and reused when supported, but the gateway must not depend on native sessions for Chat memory.

Changing models inside the same conversation is allowed. Every run stores both the requested model and the resolved model.

## 8. API Keys

Keys use a prefix such as:

```text
ahg_live_<secret>
```

Store only a strong hash and a display prefix. Secrets are shown once at creation time.

Per-key controls may include:

- enabled/disabled;
- allowed models;
- RPM limit;
- concurrent-run limit;
- optional monthly budget;
- expiry;
- last-used timestamp.

## 9. Authentication

API routes require Bearer authentication. The web dashboard uses secure HTTP-only session cookies and strong password hashing.

Open registration is disabled by default.

The service should normally be protected by a private network, Cloudflare Access, Tailscale, or a hardened reverse proxy/Tunnel.

## 10. Persistence

SQLite is the MVP default.

Recommended settings:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Primary tables:

- users;
- api_keys;
- harnesses;
- models;
- model_aliases;
- conversations;
- messages;
- runs;
- run_events;
- audit_logs.

Write transactions should be short. A PostgreSQL migration may be introduced later without changing the adapter contract or runtime services.

## 11. Usage and Cost

Use this priority for token data:

1. harness-reported usage;
2. upstream-reported usage exposed by the harness;
3. local estimation only when necessary.

Estimated cost is calculated from configured rates and labeled clearly as an estimate.

## 12. Queue and Concurrency

Start with an in-process queue.

Defaults:

- global concurrency: 1–2;
- per-key concurrency: 1;
- bounded queue;
- queue timeout;
- request timeout.

Do not introduce Redis/BullMQ unless measurements justify it.

## 13. Process Management

Each run is associated with a child process. Cancellation should send SIGTERM first and SIGKILL after a grace period if required.

Run states:

```text
queued
running
completed
failed
cancelled
timed_out
rejected
```

Do not use `sh -c` with user-controlled input. Use direct process spawning with `shell: false` or the secure equivalent.

## 14. Security

Required controls:

- authenticated `/v1/*` routes;
- model allowlists;
- input-size limits;
- no arbitrary CLI options from API input;
- safe process spawning;
- minimal environment;
- no Docker socket;
- narrow filesystem mounts;
- secret isolation;
- redacted logs;
- private network exposure by default.

Prompt injection must be treated as an untrusted-input risk. The MVP Chat environment should not expose unnecessary files, secrets, or shell access.

## 15. Docker Deployment

MVP target: one container plus persistent volumes.

Persist:

- SQLite data;
- each harness's configuration/login directory as required.

Do not expose the service on `0.0.0.0` by default. A private Docker network is preferred for same-stack clients.

## 16. Testing

### Unit

- parsers;
- serializers;
- model resolution;
- API-key auth;
- limits;
- cost calculation;
- SSE formatting.

### Contract

Every adapter passes the same normalized event contract tests.

### Integration

Use a fake harness executable with deterministic JSONL output.

### Smoke/E2E

Use real harness credentials only for optional local smoke tests. CI must remain credential-free and deterministic.

## 17. Development Phases

### Phase 0 — Foundation

Repository, agent rules, tests, license, architecture boundaries.

### Phase 1 — Research

Verify LiteLLM, verify Command-Code behavior, capture fixtures, record licensing.

### Phase 2 — POC

Prove request -> local CLI -> normalized response.

### Phase 3 — Core

Build service layer, adapter registry, process runner, run lifecycle, SQLite.

### Phase 4 — Command-Code

Implement and harden the first real adapter.

### Phase 5 — Streaming + Chat

Add SSE and the internal Chat UI.

### Phase 6 — Auth + Usage

API keys, limits, usage, estimated cost, dashboard controls.

### Phase 7 — Hermes

End-to-end Hermes integration.

### Phase 8 — Additional Adapters

Codex, Claude Code, OpenCode.

### Phase 9 — Hardening

Security, reliability, cancellation, health checks, logs, backup/retention.

### Phase 10 — Release

Apache-2.0 release, documentation, contribution guide, CI, Docker distribution.

## 18. LiteLLM Strategy

LiteLLM is a useful starting point for OpenAI-compatible gateway functionality, but Afaq should not become a large undifferentiated fork.

The preferred decision path is:

```text
Evaluate LiteLLM
      |
      v
POC / compatibility test
      |
      +--> clean integration/dependency is sufficient -> use it selectively
      |
      +--> reusable component is clearly valuable -> extract/use the allowed part
      |
      +--> only a small targeted fork provides major benefit -> document and maintain it
```

Always verify the exact version's license boundaries before redistribution. Keep Afaq's adapter protocol independent of LiteLLM internals.

## 19. Open Source Strategy

Recommended project license: Apache-2.0.

The core should remain open and self-hostable. Any future hosted/commercial services should be additive rather than required for the open-source runtime.

## 20. Final Architecture Principle

The most important design rule is:

> **Clients should depend on a stable OpenAI-compatible interface; the core should depend on a stable adapter contract; only adapters should depend on individual harness CLIs.**

This allows Hermes to be one client today while preserving the ability to support many clients and many harnesses tomorrow.
