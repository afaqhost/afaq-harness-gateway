# Phase 10 — Harness Platform Core

## Objective

Turn the existing adapter-oriented runtime into a platform that explicitly models Harness definitions, installations, credential references, instances, capabilities, and lifecycle state.

Do not replace the existing runtime. Extend it.

## Required concepts

```text
Harness Definition
    ↓
Harness Installation
    ↓
Credential Profile
    ↓
Harness Instance
    ↓
Adapter
    ↓
Models / Capabilities
```

The implementation may refine names, but the separation must remain.

## Definition vs installation vs instance

A Definition describes what a Harness is.

An Installation describes one installed version/path of that Harness.

A Credential Profile identifies an authentication configuration without exposing its secret material.

A Harness Instance represents the active combination used by the runtime.

An Adapter remains responsible for Harness-specific execution behavior.

## Capabilities

Represent capabilities structurally, for example:

```text
streaming
sessions
usage
tool_events
cancellation
model_selection
```

Do not assume all Harnesses support everything.

## Lifecycle

Support deterministic state such as:

```text
discovered
available
installed
configured
authenticated
enabled
healthy
disabled
unhealthy
update_available
removed
```

## Requirements

- Preserve the existing Adapter contract.
- Preserve OpenAI-compatible API behavior.
- Preserve model routing.
- Allow multiple Harnesses to coexist.
- Do not make Command-Code the default universal runtime.
- Do not make Hermes a platform entity.
- Keep Harness-specific behavior behind adapters.

## Non-goals

Do not build:
- full installation UI
- automatic updates
- tenant hosting
- billing

## Acceptance criteria

- Platform entities are implemented and tested.
- Lifecycle transitions are deterministic.
- Existing adapters are still usable through the platform layer.
- Multiple Harness records can coexist.
- Existing API tests stay green.
