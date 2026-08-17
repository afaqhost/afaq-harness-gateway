# Command-Code CLI — Harness Verification Record

Spec: `01-research/02_HARNESS_VERIFICATION.md`

## Tested version

**1.26.0** — reported by both `cmd --version` and `cmd info`.

## Installation method

Global npm install. Binary at `/home/nasser/.npm-global/bin/cmd`.

## Authentication method

Command Code account login via `cmd login`. `cmd status` reports: `Authenticated as mejxuf / Provider: Command Code`.

## Headless command

```
cmd -p --output-format json -m "deepseek/deepseek-v4-flash" "<prompt>"
```

Flags:
- `-p` — headless / non-interactive mode
- `--output-format json` — emits NDJSON on stdout
- `-m <id>` / `--model <id>` — model selection

## Model selection syntax

`--model <id>` or `-m <id>`. Verified model id: `deepseek/deepseek-v4-flash`.

## Output format

NDJSON event stream — one JSON object per line, ending with a final `{"type":"result",...}` frame.

### Observed event types

| Event type | Description |
|---|---|
| `run_start` | Run begins; includes `sessionId` |
| `turn_start` | Turn begins |
| `message_start` | Assistant message begins |
| `model_request_start` | Model call begins |
| `model_trace` | Model routing/trace info |
| `thinking_start` | Thinking block begins |
| `thinking_delta` | Thinking content chunk |
| `thinking_end` | Thinking block ends |
| `text_delta` | Assistant text chunk |
| `message_update` | Message metadata update |
| `model_request_end` | Model call ends; includes usage |
| `message_end` | Assistant message ends |
| `turn_end` | Turn ends; includes usage |
| `run_end` | Run ends; includes `result.nextState` for session continuation |
| `result` | Terminal frame with final text, usage, sessionId, nextState |

### Normalization note

`thinking_*` events must be filtered/ignored when normalizing to the gateway's `HarnessEvent` contract (which has no thinking event type). The output is a full NDJSON stream, not just `text_delta`.

## Streaming behavior

**Verified.** The NDJSON stream delivers events incrementally. `text_delta` events arrive as the model generates tokens. The final `result` frame signals completion.

## Session behavior

Each run has a `sessionId`. The `run_end.result.nextState` carries the full message history and a `nextState.sessionId` for continuation in subsequent runs.

## Usage / token reporting

Present on `model_request_end`, `turn_end`, `run_end`, and the `result` frame as:

```json
{ "inputTokens": <n>, "outputTokens": <n>, "cacheReadTokens": <n>, "cacheWriteTokens": <n> }
```

No `costUsd` field observed.

## Exit codes

**Verified at the adapter level.** The adapter maps exit codes to harness events via `mapCcExitCode`:

| Code | Meaning | Retryable |
|---|---|---|
| 0 | Success | — |
| 3 | Authentication error | No |
| 4 | Permission error | No |
| 5 | Rate limit exceeded | Yes |
| 6 | Network error | Yes |
| 7 | Upstream server error | Yes |
| 8 | Max turns reached | No |
| 9 | No response | No |
| 10 | Insufficient credits | No |
| 130 | Interrupted | No |
| other | Unknown error | No |

Non-zero exit codes are surfaced as `{ type: "failed", message, retryable }` events.

## Cancellation behavior

**Verified at the adapter level.** `ProcessRunner.cancel()` sends SIGTERM first, then SIGKILL after a 2-second grace period. The generator throws `ProcessCancelledError` without emitting any `completed` or `failed` event.

## Timeout behavior

**Verified at the adapter level.** `ProcessRunner.run()` accepts `timeoutMs`. When exceeded, the process is killed with SIGKILL and the generator throws `ProcessTimedOutError`. No `completed` or `failed` event is emitted.

## Known limitations

1. `thinking_*` events have no corresponding type in the `HarnessEvent` contract; adapters must filter them.
2. The NDJSON stream includes many event types beyond `text_delta`; the adapter must parse and dispatch selectively.
3. `costUsd` is not reported; pricing must be computed externally if needed.
4. Exit codes, cancellation, and timeout behavior are verified at the adapter level (Phase 04).

## Licensing / terms constraints

**Not verified in this phase.** Out of scope for Phase 01; see `docs/SOURCE_NOTES.md`.

## Captured fixtures

| Fixture | Path |
|---|---|
| Headless NDJSON run | `01-research/fixtures/command-code/headless-run.ndjson` |
