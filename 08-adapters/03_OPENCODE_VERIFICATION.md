# OpenCode Adapter Verification

## Binary

- **Binary name**: `opencode`
- **Installed version**: 1.18.15
- **Version check**: `opencode --version` prints `1.18.15` to stdout, exits 0.

## Headless Command

```
opencode run --format json --model <model> <prompt>
```

- `run` subcommand with `--format json` emits NDJSON (one JSON object per line) to stdout.
- `--model` selects the provider-qualified model id (e.g. `opencode/mimo-v2.5-free`).
- The prompt is the last positional argument.

## JSONL Event Schema (observed with 1.18.15)

| Event type       | Key fields                                                       | Notes                                        |
|------------------|------------------------------------------------------------------|----------------------------------------------|
| `step_start`     | `sessionID`                                                      | Signals run/session begin.                   |
| `text`           | `part: { type: "text", text }`                                   | Incremental text output from the model.      |
| `step-finish`    | `part: { reason }`, `sessionID`, `tokens?`, `cost?`             | Signals run/session end with usage.          |
| `error`          | `message`                                                        | Top-level error frame.                       |

### `tokens` object inside `step-finish`

The `tokens` and `cost` fields are nested inside the `part` object of `step-finish`:

```json
{
  "part": {
    "reason": "stop",
    "tokens": {
      "input": 10,
      "output": 5,
      "reasoning": 0,
      "cache": { "read": 4, "write": 0 }
    },
    "cost": 0
  }
}
```

## Normalization Map

| OpenCode event                              | HarnessEvent                                                    |
|---------------------------------------------|-----------------------------------------------------------------|
| `step_start` with `sessionID`               | `{ type: "started", sessionId }`                               |
| `text` with `part.text`                     | `{ type: "text_delta", text }`                                 |
| `step-finish` with `tokens`                 | `{ type: "usage", usage: { inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, totalTokens, costUsd } }` |
| `step-finish` with `tokens` + finalText     | `{ type: "completed", text, sessionId, usage }`               |
| `step-finish` with `part.reason === "error"`| `{ type: "failed", message: "OpenCode run failed", retryable: false }` |
| `error` with `message`                      | `{ type: "failed", message, retryable: false }`               |

### Usage field mapping

| OpenCode `tokens` field | HarnessEvent `Usage` field |
|------------------------|-----------------------------|
| `part.tokens.input`         | `inputTokens`               |
| `part.tokens.output`        | `outputTokens`              |
| `part.tokens.cache.read`    | `cachedInputTokens`         |
| `part.tokens.cache.write`   | `cacheWriteTokens`          |
| `part.tokens.total` (or input+output) | `totalTokens`       |
| `part.cost`     | `costUsd`                   |

## Default Model Record

- **Model id**: `opencode/mimo-v2.5-free` (provider-qualified, as the CLI expects)
- The gateway will expose it as `opencode/opencode/mimo-v2.5-free` and resolve `request.model` back to `opencode/mimo-v2.5-free`.

## Capabilities

- `health()`: runs `opencode --version` via `spawnSync` with 5s timeout.
- `listModels()`: returns configured model list (defaults to `["opencode/mimo-v2.5-free"]`).
- `run()`: serializes messages, spawns `opencode run --format json --model <model> <prompt>`, parses NDJSON, normalizes events.
- `cancel()`: delegates to `ProcessRunner.cancel()` (SIGTERM with 2s grace then SIGKILL).

## Config/Login Volume

- OpenCode stores auth and config via XDG directories.
- `XDG_DATA_HOME`: controls data directory (auth.json lives here).
- `XDG_CONFIG_HOME`: controls config directory.
- When `configDir` is set on the adapter, both `XDG_DATA_HOME` and `XDG_CONFIG_HOME` are set to that path in the minimal env, isolating auth and config from the host.
- When `configDir` is absent, neither is set (OpenCode uses system defaults).

## Known Limitations

1. **No token-level text_delta**: Beyond `text` events, there is no granular token-by-token streaming in captured output. The adapter yields each `text` event's content as a single `text_delta`.
2. **Tool/lifecycle events ignored**: Events like tool calls, lifecycle transitions, and other non-mapped types are silently dropped by the normalizer.
3. **Real runs need provider credentials**: The `opencode run` command requires valid provider credentials (API keys or OAuth). Without them, real runs will fail with auth errors.
4. **costUsd from part.cost field**: The `cost` field nested under `part` on `step-finish` is mapped directly to `costUsd`. If `cost` is absent, `costUsd` will be `undefined`.
