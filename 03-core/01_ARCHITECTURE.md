# Core Architecture

## Goal

Build an application core that does not know Command-Code, Codex, Claude Code, or OpenCode implementation details.

## Layers

```text
HTTP/API
  -> Authentication
  -> Model resolution
  -> Run service
  -> Queue / concurrency
  -> Adapter registry
  -> HarnessAdapter
  -> Process runner
  -> CLI
```

## Core boundaries

- Routes validate transport-level input only.
- Services own business logic.
- Adapters own CLI-specific behavior.
- Process runner owns safe child-process lifecycle.
- Database layer owns persistence.
- UI calls the same service layer as the API.

## Model IDs

Preferred formats:

```text
<harness>/<provider>/<model>
<harness>/<model>
```

Aliases resolve to canonical model IDs before execution.

## Run states

```text
queued -> running -> completed
              |-> failed
              |-> cancelled
              |-> timed_out
queued -> rejected
```
