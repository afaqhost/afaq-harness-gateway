# Codex Adapter Verification

## Installed Version

codex-cli 0.147.0

Binary: `codex`

## Headless Command

```
codex exec --json --ephemeral --skip-git-repo-check -m <model> <prompt>
```

- `exec`: run a single prompt headlessly (non-interactive).
- `--json`: emit NDJSON events on stdout.
- `--ephemeral`: do not persist conversation state.
- `--skip-git-repo-check`: allow running outside a git repository.
- `-m <model>`: select model.

## Observed JSONL Event Types

The Codex CLI emits flat JSON objects (one per line). The adapter normalizes these:

| Codex Event | Normalized HarnessEvent |
|---|---|
| `{ type: "thread.started", thread_id }` | `{ type: "started", sessionId }` |
| `{ type: "item.completed", item: { type: "agent_message", text } }` | `{ type: "text_delta", text }` |
| `{ type: "turn.completed", usage: { input_tokens, cached_input_tokens, output_tokens } }` | `{ type: "usage", usage: { inputTokens, cachedInputTokens, outputTokens, totalTokens } }` then `{ type: "completed", text, sessionId, usage }` |
| `{ type: "turn.failed", error: { message } }` | `{ type: "failed", message, retryable: false }` |
| `{ type: "error", message }` | `{ type: "failed", message, retryable: false }` |

All other event types (thread/turn/item lifecycle, reasoning, etc.) are ignored.

## Default Models

- `gpt-5.6-luna`

## Capabilities

- Headless JSONL execution via `codex exec --json`.
- Usage reporting (input_tokens, cached_input_tokens, output_tokens) via turn.completed.
- Session identification via thread_id in thread.started.
- Cancellation and timeout via ProcessRunner (SIGTERM/SIGKILL).
- Ephemeral runs with no persistent state.

## Config / Login Volume

- `CODEX_HOME` environment variable controls the config directory (default: `~/.codex`).
- When `configDir` is provided to CodexAdapter, `CODEX_HOME` is set in the process environment.
- Authentication is managed by the Codex CLI itself (ChatGPT account).

## Limitations

- ChatGPT account may hit usage limits; real smoke tests are opt-in via `RUN_REAL_HARNESS`.
- JSONL has no token-level text deltas; `text_delta` events are emitted per complete `agent_message` rather than incrementally.
- Reasoning and lifecycle events are silently ignored by the normalizer.
- No tool-level events (tool_started/tool_finished) in the Codex JSONL schema.
