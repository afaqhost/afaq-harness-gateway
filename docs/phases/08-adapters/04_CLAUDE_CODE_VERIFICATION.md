# Phase 08 — Claude Code Adapter Verification

## Binary

- **Name**: `claude`
- **Default path**: `claude` (resolves via PATH)
- **Version verification**: Not installed locally; version documented from official Anthropic CLI docs.

## Headless invocation

```bash
claude -p --output-format json --model <model> <prompt>
```

### Optional streaming mode

```bash
claude -p --output-format stream-json --verbose --include-partial-messages --model <model> <prompt>
```

The streaming mode emits `stream_event` objects with `content_block_delta` / `text_delta` shapes. This adapter handles both modes — `--output-format json` emits `assistant` + `result` events, while `stream-event` deltas are also normalized if present.

## Normalized event mapping

| Claude Code event | Harness event |
|---|---|
| `{ type:"system", subtype:"init", session_id }` | `{ type:"started", sessionId }` |
| `{ type:"stream_event", event:{ type:"content_block_delta", delta:{ type:"text_delta", text } } }` | `{ type:"text_delta", text }` |
| `{ type:"assistant", message:{ content:[{ type:"text", text }] } }` | `{ type:"text_delta", text }` (only if no stream_event text has been emitted) |
| `{ type:"result", subtype:"success", usage, session_id, total_cost_usd }` | `{ type:"usage", usage }` + `{ type:"completed", text, sessionId, usage }` |
| `{ type:"result", subtype:"error_*", error?/result? }` | `{ type:"failed", message, retryable:false }` |
| `{ type:"error", ... }` | `{ type:"failed", message, retryable:false }` |

### Usage field mapping

| Claude Code field | Harness Usage field |
|---|---|
| `usage.input_tokens` | `inputTokens` |
| `usage.output_tokens` | `outputTokens` |
| `usage.cache_read_input_tokens` | `cachedInputTokens` |
| `usage.cache_creation_input_tokens` | `cacheWriteTokens` |
| `input_tokens + output_tokens` | `totalTokens` |
| `total_cost_usd` | `costUsd` |

## Default model record

- **Model ID**: `claude-sonnet-4-6`
- Exposed by the gateway as `claude-code/claude-sonnet-4-6`; the gateway resolves `request.model` back to `claude-sonnet-4-6` before passing it to the adapter.

## Capabilities

| Capability | Supported |
|---|---|
| health check (`--version`) | Yes |
| model listing | Static list (configurable) |
| headless prompt (`-p`) | Yes |
| JSON output (`--output-format json`) | Yes |
| stream-json output | Normalized (stream_event deltas) |
| session tracking | Via `session_id` in init/result events |
| usage extraction | input/output/cached/cache-write tokens + cost |
| process timeout | Via ProcessRunner |
| cancellation | Via ProcessRunner (SIGTERM + SIGKILL) |

## Config / Login volume

- **Environment variable**: `CLAUDE_CONFIG_DIR`
- **Default location**: `~/.claude` (Claude Code's built-in default when the env var is unset)
- When `configDir` is provided to the adapter, `CLAUDE_CONFIG_DIR` is set in the spawned process environment, redirecting all config and login state.
- When `configDir` is absent, the env var is left unset (Claude Code uses its default).

## Known limitations

1. **Not locally smoke-tested**: The `claude` CLI is not installed on this machine. The adapter is verified via a deterministic shim (`testing/fixtures/claude-code/claude-shim.mjs`). The real smoke test is opt-in via `RUN_REAL_HARNESS=1`.
2. **JSON result-mode is not token-streaming**: `--output-format json` emits a single `assistant` message and a final `result` event — it does not stream individual tokens. True token streaming requires `--output-format stream-json`, which this adapter handles but is not the default invocation path.
3. **stream-json text_delta shape**: The `stream_event` / `content_block_delta` / `text_delta` shape is documented from Claude Code's public schema but must be re-verified on the installed version when available, as event structures may vary across CLI versions.
4. **Error subtypes**: The adapter treats any non-`success` result subtype as a failure. Specific subtypes (`error_max_turns`, `error_during_execution`, etc.) are not enumerated — the message is extracted from whichever field is present (`error` or `result`).
