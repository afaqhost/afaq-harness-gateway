# Supported Harnesses

Afaq Harness Gateway ships with four built-in adapters. Each adapter wraps a
local CLI binary and normalizes its output into the gateway's internal event
stream.

The adapter contract is defined in `contracts/HARNESS_ADAPTER.md`. The gateway
owns normalized events; adapters own CLI-specific argument construction and
output parsing.

> **Important:** CLI output schemas, event formats, and flags can change
> between versions of the underlying CLI. The flags documented below reflect
> the adapter source code. Verify against your installed CLI version if you
> encounter issues.

---

## command-code

| Field            | Value                                      |
|------------------|--------------------------------------------|
| Adapter ID       | `command-code`                             |
| CLI binary       | `cmd` (configurable via `cmdPath`)         |
| Default model    | `deepseek/deepseek-v4-flash`               |
| Authentication   | CLI login / provider credential store      |
| Config dir env   | (none -- uses default CLI config location) |

### CLI flags

```
cmd -p --output-format json -m <model> <prompt>
```

- `-p` -- pipe mode
- `--output-format json` -- emit JSONL events to stdout
- `-m <model>` -- select model

### Health check

Runs `cmd --version` with a 5-second timeout.

### Exit code mapping

The adapter maps specific exit codes to error messages:

| Code | Meaning                | Retryable |
|------|------------------------|-----------|
| 3    | Authentication error   | No        |
| 4    | Permission error       | No        |
| 5    | Rate limit exceeded    | Yes       |
| 6    | Network error          | Yes       |
| 7    | Upstream server error  | Yes       |
| 8    | Max turns reached      | No        |
| 9    | No response            | No        |
| 10   | Insufficient credits   | No        |
| 130  | Interrupted            | No        |

---

## codex

| Field            | Value                                      |
|------------------|--------------------------------------------|
| Adapter ID       | `codex`                                    |
| CLI binary       | `codex` (configurable via `codexPath`)     |
| Default model    | `gpt-5.6-luna`                             |
| Authentication   | CLI login / provider credential store      |
| Config dir env   | `CODEX_HOME` (when `configDir` is set)     |

### CLI flags

```
codex exec --json --ephemeral --skip-git-repo-check -m <model> <prompt>
```

- `exec` -- single-run execution mode
- `--json` -- emit JSONL events to stdout
- `--ephemeral` -- no persistent state between runs
- `--skip-git-repo-check` -- do not require a git repository
- `-m <model>` -- select model

### Health check

Runs `codex --version` with a 5-second timeout.

---

## claude-code

| Field            | Value                                      |
|------------------|--------------------------------------------|
| Adapter ID       | `claude-code`                              |
| CLI binary       | `claude` (configurable via `claudePath`)   |
| Default model    | `claude-sonnet-4-6`                        |
| Authentication   | CLI login / provider credential store      |
| Config dir env   | `CLAUDE_CONFIG_DIR` (when `configDir` is set) |

### CLI flags

```
claude -p --output-format json --model <model> <prompt>
```

- `-p` -- pipe mode
- `--output-format json` -- emit JSONL events to stdout
- `--model <model>` -- select model

### Health check

Runs `claude --version` with a 5-second timeout.

### Notes

The adapter handles both streaming (`stream_event` with `content_block_delta`)
and non-streaming (`assistant` message) text output. It reports `costUsd` when
the CLI provides `total_cost_usd` in the result event.

---

## opencode

| Field            | Value                                      |
|------------------|--------------------------------------------|
| Adapter ID       | `opencode`                                 |
| CLI binary       | `opencode` (configurable via `opencodePath`) |
| Default model    | `opencode/mimo-v2.5-free`                  |
| Authentication   | CLI login / provider credential store      |
| Config dir env   | `XDG_DATA_HOME` and `XDG_CONFIG_HOME` (when `configDir` is set) |

### CLI flags

```
opencode run --format json --model <model> <prompt>
```

- `run` -- single-run execution mode
- `--format json` -- emit JSONL events to stdout
- `--model <model>` -- select model

### Health check

Runs `opencode --version` with a 5-second timeout.

---

## Environment isolation

All adapters run with a minimal environment built by `buildMinimalEnv()`.
Only the following host variables are forwarded: `HOME`, `PATH`, `USER`,
`SHELL`, `LANG`, `LC_ALL`, `TMPDIR`. Adapter-specific variables (such as
`CODEX_HOME` or `CLAUDE_CONFIG_DIR`) are added on top when configured.

## Model naming

Models are namespaced as `<adapter-id>/<model-name>` in the gateway API. For
example, `command-code/deepseek/deepseek-v4-flash` routes to the command-code
adapter with the `deepseek/deepseek-v4-flash` model.

## External licensing

The four Harness CLIs are external tools developed and licensed by their
respective vendors. Afaq Harness Gateway's Apache-2.0 license does not grant
any rights to these third-party tools or their associated provider
subscriptions. Install, authenticate, and use each CLI under its own terms.
