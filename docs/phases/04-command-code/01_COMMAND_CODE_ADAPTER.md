# Command-Code Adapter

## Goal

Implement the first production adapter using only the verified Command-Code CLI contract.

Do not copy unverified flags from older documentation. Capture the exact installed version and test the actual command.

## Required behavior

- health check;
- model listing from configured records;
- safe prompt/message serialization;
- non-streaming execution;
- incremental JSON/NDJSON parsing;
- normalized text events;
- usage extraction when available;
- controlled errors;
- timeout;
- cancellation;
- deterministic fixtures.

## Security

- `spawn()` with `shell: false` or equivalent;
- no user-controlled command string;
- no raw CLI flags from API input;
- minimal environment;
- no Docker socket;
- no secrets in logs.

## Fixture strategy

Store representative stdout streams for:

- success;
- streaming text;
- tool events;
- usage;
- malformed lines;
- final result;
- CLI error.

Use fixtures in CI so tests do not consume paid credits.
