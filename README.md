# Afaq Harness Gateway — Implementation Pack

This package is the execution specification for building **Afaq Harness Gateway** as a self-hosted, OpenAI-compatible gateway for local/headless AI harnesses.

## Core idea

```text
OpenAI-compatible client
        |
        v
Afaq Harness Gateway
        |
        v
Harness Adapter
        |
        v
Local Harness CLI
        |
        v
Model / Account
```

The first production path is **Command-Code**. Codex, Claude Code, and OpenCode are added only after the first adapter is stable.

## Critical project rules

- Build in phases. Never implement the entire project in one pass.
- Preserve the adapter boundary. Route handlers must not contain harness-specific CLI logic.
- Use OpenAI-compatible HTTP/SSE as the stable external contract.
- Start with SQLite + WAL and an in-process queue.
- Do not add Redis, PostgreSQL, Kubernetes, or distributed workers to the MVP without a documented reason.
- Never pass raw user-controlled shell strings to a shell.
- Never log API secrets, Authorization headers, harness login tokens, or full environment files.
- Every meaningful feature needs tests.
- Every phase ends with tests, review, documentation update, and a git commit.

## AI execution model

The recommended workflow is:

```text
Lead / Architect model
        |
        +--> delegate implementation task
                    |
                    v
            Command-Code + worker model
                    |
                    v
                 tests
                    |
                    v
            Lead / Reviewer model
```

The implementation worker must follow the written phase specification and must not redesign the architecture without an explicit ADR.
