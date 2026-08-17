# Phase 02 — POC Findings

## Verified path

```text
POST /v1/chat/completions
        -> router (node:http)
        -> HarnessAdapter.run()
        -> safe child process (shell:false)
        -> NDJSON parser (incremental)
        -> normalized HarnessEvent[]
        -> OpenAI chat.completion response
```

## What was proven

- A minimal OpenAI-compatible endpoint works with Node's built-in HTTP server and no framework.
- The fake harness produces deterministic `HarnessEvent` JSONL with no network or credentials.
- The real Command-Code CLI (`cmd 1.26.0`) is successfully spawned headlessly and normalized from its NDJSON stream to the gateway contract. Verified live against `deepseek/deepseek-v4-flash` with a "VERIFIED" prompt.
- Shell injection is prevented by `spawn(..., { shell: false })` with an argument array; client messages are passed literally and never interpolated into a shell string.
- Process timeout kills the child with `SIGKILL` and surfaces a controlled `failed` event.
- Malformed harness output produces a controlled `JsonlParseError` -> 502 response, not an uncaught crash.

## Command-Code normalization notes

- Command-Code wraps each event as `{"type":"event","event":{...}}` and terminates with `{"type":"result",...}`.
- `thinking_*` events are filtered out (the gateway contract has no thinking event).
- Usage is reported on `model_request_end`, `run_end`, and `result` as `inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheWriteTokens`. No `costUsd`; total is derived when absent.
- `sessionId` comes from `run_start` and the final `result`/`run_end`.

## Known limitations (deferred to Phase 03+)

- `HarnessAdapter.cancel()` is a no-op; real cancellation is Phase 03 scope.
- `health()` and `listModels()` return static placeholders.
- Streaming (`stream=true`) is deliberately rejected; SSE is Phase 05.
- Message serialization for Command-Code is a simple `[role]\ncontent` join; structured multi-turn continuation is deferred.
- No auth, API keys, SQLite, queue, or usage/cost yet.

## Test status

- Default suite: 41 passed, 1 skipped (opt-in real smoke).
- Real Command-Code smoke (`RUN_REAL_HARNESS=1`): passed.
