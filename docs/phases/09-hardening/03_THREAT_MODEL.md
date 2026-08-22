# Threat Model

This document is the Phase 09 hardening threat model for Afaq Harness Gateway. It
records the threats the gateway must defend against and the controls in place at the
time of hardening.

## Trust boundaries

```text
Client (untrusted)
        |
        |  OpenAI-compatible HTTP/SSE over TLS-terminating reverse proxy
        v
Gateway API (trusted boundary)
        |
        +-- Auth / keys
        +-- Model registry / aliases
        +-- Run service / queue
        +-- Adapter registry
                 |
                 v
        Local harness CLI (process boundary)
                 |
                 v
        Model / account provider
```

Every client request and every model response is untrusted input. Every harness CLI is
an untrusted subprocess whose output must be parsed defensively.

## Threats and controls

| # | Threat | Control |
|---|--------|---------|
| T1 | Shell/argument injection via prompt content | `shell: false` everywhere; prompts passed as a single argv element, never interpolated into a shell string. |
| T2 | Stolen or replayed API keys | Keys stored as scrypt hashes only; raw keys returned exactly once at creation; key prefix only in listings; disabled/expired keys rejected before execution. |
| T3 | Harness account/secret leakage | Harness processes run with a minimal allowlisted environment (`src/harness/env.ts`); no host environment is passed by default. |
| T4 | Prompt injection | Model responses treated as untrusted data; the Chat UI escapes content before rendering (`textContent`, no `innerHTML` with user data). |
| T5 | Excessive concurrency/cost | Per-key RPM, concurrency, and monthly budget limits; bounded in-process queue with capacity and queue timeout; run timeout. |
| T6 | Sensitive data in logs | JSON-line logger redacts Authorization headers, raw keys, and password-like assignments; run logs never include prompts, events, usage, or session content. |
| T7 | Oversized requests | Request body size limit (default 1 MiB) with HTTP 413. |
| T8 | Unauthorized model use | Model allowlists enforced per key before process execution. |
| T9 | Child-process leak / hang | SIGTERM then SIGKILL after grace; detached process groups killed; run timeout; client disconnect cancels the run. |
| T10 | Insecure network exposure | The gateway must not be exposed directly; deploy behind a private network, Cloudflare Tunnel + Access, Tailscale, or a hardened HTTPS reverse proxy with an auth layer. |
| T11 | Unauthorized UI access | Chat/conversation routes require a valid session when auth is configured. |

## Residual risks

- The gateway has no built-in TLS termination; it relies on the deployment layer.
- SQLite is the MVP store; backups and secret rotation are operational responsibilities
  documented in `04_RETENTION_BACKUP.md`.
- The fake harness used for CI is deterministic and credential-free; real-harness smoke
  tests are opt-in only.
