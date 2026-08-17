# Fake Harness Strategy

## Goal

Enable deterministic, credential-free adapter and integration tests without depending on any real harness CLI or paid API.

## Approach

A **fake harness** is a lightweight executable (shell script or compiled binary) that lives in the test fixtures directory. It:

- accepts the same CLI arguments as the real harness;
- emits deterministic JSONL/NDJSON output to stdout;
- always exits with a predictable status code;
- requires no network access and no credentials;
- is fast enough to run in CI on every push.

## Event fixture format

Fixture files are plain `.jsonl` — one JSON object per line — matching the `HarnessEvent` discriminated union in `contracts/HARNESS_ADAPTER.md`. Example:

```jsonl
{"type":"started","sessionId":"fake-session-001"}
{"type":"text_delta","text":"Hello from fake harness."}
{"type":"usage","usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15,"costUsd":0}}
{"type":"completed","text":"Hello from fake harness.","sessionId":"fake-session-001","usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15,"costUsd":0}}
```

## Test categories

| Category | Harness | Runs in CI |
|---|---|---|
| Unit | None (pure functions) | Always |
| Contract | Fake harness (deterministic fixtures) | Always |
| Integration | Fake harness (end-to-end pipeline) | Always |
| Smoke (real) | Real harness (opt-in, local only) | Never |

## Requirements

1. **No network** — the fake harness must not open sockets, resolve DNS, or make HTTP requests.
2. **No credentials** — it must not read environment variables for API keys or tokens.
3. **Deterministic** — given the same fixture file, output is byte-identical on every run.
4. **Portable** — works on Linux, macOS, and Windows CI runners.

## Real-harness smoke tests

Real-harness tests are gated behind an explicit opt-in flag (e.g. `RUN_REAL_HARNESS=1`) and require the harness CLI to be installed locally. They are never part of the default CI matrix and never require paid credentials.
