# Phase 12 — Credentials + Multi-Harness Lifecycle

## Objective

Make Harness authentication and lifecycle management first-class while keeping credentials isolated from generic model and runtime data.

## Credential Profiles

A Harness may have one or more profiles where supported:

```text
Claude Code
 ├── personal
 └── work

Codex
 └── primary
```

Support different authentication mechanisms:

- CLI login
- API-key reference
- environment-based credential reference
- OAuth/browser flow
- provider-specific credential store

Do not force every Harness into one credential format.

## Secret rules

- Never log raw credentials.
- Never return raw credentials after setup.
- Do not put raw credential material into ordinary database records unless an explicit secure-secret design permits it.
- Prefer Harness-native credential stores or a dedicated secret mechanism.
- Expose status without exposing secret material.

## Lifecycle management

Operators should be able to:

- list Harness installations
- enable/disable them
- select an installation
- select a credential profile
- inspect capabilities
- run health checks
- select models
- remove an installation

## Runtime resolution

```text
Requested Model
    ↓
Harness Definition
    ↓
Harness Installation
    ↓
Credential Profile
    ↓
Adapter
    ↓
Process
```

Unavailable elements must produce controlled errors.

## Backward compatibility

Existing OpenAI-compatible API clients, Hermes integration, streaming, cancellation, and model routing must remain green.

## Acceptance criteria

- Credentials are separated from installations.
- Multiple profiles work where supported.
- Authentication state is observable safely.
- Enable/disable is enforced.
- Installation/profile selection is honored by execution.
- Multiple Harnesses operate concurrently.
- Existing API behavior remains compatible.
