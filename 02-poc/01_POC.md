# Phase 02 — Proof of Concept

## Goal

Prove the smallest viable path:

```text
OpenAI-compatible request
        -> router
        -> local harness process
        -> parser
        -> normalized response
```

## Deliverables

- minimal HTTP endpoint;
- one fake harness;
- one real Command-Code smoke path when credentials are available;
- JSONL parser;
- non-streaming response formatter;
- safe process spawning;
- process timeout;
- failure propagation.

## Constraints

The POC must not depend on a production UI, Redis, PostgreSQL, or distributed workers.

## Acceptance tests

1. Fake harness returns deterministic response.
2. Malformed harness output produces a controlled error.
3. Client input cannot inject shell syntax.
4. Timeout terminates the child process.
5. Real Command-Code smoke test works locally if configured.
