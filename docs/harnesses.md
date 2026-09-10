# Harness Integrations

Harnesses are local CLI adapters defined in `app/harnesses/registry.py`. The gateway checks whether each executable is available on `PATH`, discovers models, builds a command, and parses the command output.

## Supported Adapters

| Harness | Executable | Installation recipe in the adapter | Model discovery |
| --- | --- | --- | --- |
| Codex | `codex` | `npm install -g @openai/codex` | Reads `~/.codex/models_cache.json`, with a fallback list |
| OpenCode | `opencode` | `npm install -g opencode-ai` | Runs `opencode models` |
| Command Code | `cmd` | `npm install -g command-code` | Runs `cmd --list-models` |
| Claude Code | `claude` | `npm install -g @anthropic-ai/claude-code` | Uses the adapter's standard Claude model names when installed |
| Agy (Google Antigravity) | `agy` | `npm install -g @google/agy` | Runs `agy models` (parses first column) |
| Pi | `pi` | `npm install -g pi` | Runs `pi --list-models` (parses provider + model) |
| Minimax | `minimax` | `npm install -g minimax-cli` | Runs `minimax --list-models` (fallback static `minimax-m2`) — Generic placeholder until CLI verified |
| Kimi | `kimi` | `npm install -g @moonshot/kimi-code` | Generic `kimi --help` (stream-json) — placeholder `[]` if not installed |
| Grok | `grok` | `npm install -g @xai-official/grok` | Generic streaming-json — placeholder until `grok --help` verified |
| Cline | `cline` | `npm install -g @cline/cli` | Generic `cline --help` — placeholder |
| Cursor | `cursor-agent` | `cursor-agent` binary | Generic placeholder |
| Muse | `copilot` | `npm install -g @github/copilot` | Generic placeholder |
| Warp | `oz` | `oz` (Warp Agent) | Generic placeholder |
| Zcode | `zcode` | `zcode` bundled app | Generic placeholder (`--mode plan`) |
| Aider | `aider` | `pip install aider-chat` (manual) | Generic static `["default"]` — no npm recipe |
| OMP | `omp` | `omp` binary (manual) | Generic placeholder |
| Qoder | `qodercli` | `qodercli` binary (manual) | Generic placeholder |
| Vibe | `vibe` | `vibe` binary (manual) | Generic placeholder |

> Registry: `app/clients/registry.py:20` (`ADAPTERS`) — facade mirrored at `app/harnesses/registry.py`. Adapters with `is_installed() == False` return `[]` from `list_models()` and appear as `installed: false` in `GET /health` and `GET /api/admin/harnesses`.
> Custom adapters: `claude`, `codex`, `opencode`, `commandcode`, `agy` (`app/clients/agy.py`), `pi` (`app/clients/pi.py`). Remaining 12 are `GenericAdapter` (text-only, `app/clients/generic.py`) and can be upgraded to Custom (`parse_line` tool calls, `--read-only` flags) in `docs/harness-expansion/phase-03-custom-adapters.md`.

Install and authenticate each CLI through its official documentation. The gateway does not proxy or replace a harness provider's login flow.

## Model Names

Use the model identifier returned by `GET /v1/models`. Examples include:

```text
codex//gpt-5.6-terra
opencode//opencode/big-pickle
commandcode//claude-sonnet-4-6
agy//gemini-3.6-flash-high
pi//github-copilot/claude-sonnet-4.6
minimax//minimax-m2
kimi//kimi-k2.7-code
grok//grok-4.5
```

The first segment selects the adapter. The adapter receives the remaining model value.

## Refreshing Models

Models are loaded when the server starts. To refresh after installing a CLI, changing credentials, or changing provider configuration:

1. Open the dashboard's **Harnesses** page.
2. Select **Refresh models**.
3. Return to **Chat** and choose the updated model list.

The refresh endpoint is `POST /api/admin/harnesses/refresh` and requires dashboard authentication.

## Adding a Harness

1. Add a `HarnessAdapter` implementation in `app/clients/<name>.py` (use `app/clients/generic.py` `GenericAdapter` for text-only harnesses).
2. Set `name`, `display_name`, and `executable`.
3. Implement `build_command()` — see `app/clients/claude.py`, `app/clients/agy.py`, `app/clients/pi.py` for examples (`--print`, `--mode json`, `--model`, `--session`).
4. Implement `parse_line()` for streaming output and `parse_output()` when non-streaming output needs normalization (tool_calls via `{"tool_call": {...}}` normalized to `{"id","type":"function","function":{"name","arguments"}}`).
5. Implement `list_models()` with the CLI's actual discovery mechanism (or fallback `[]` / static list if CLI has no command — like `claude.py:44`).
6. Add the adapter instance to `ADAPTERS` in `app/clients/registry.py:20` (mirrored in `app/harnesses/registry.py`).
7. Test installation detection (`is_installed()` via `shutil.which`), model discovery, non-streaming output, streaming output, and non-zero exit handling.
8. Update inventory in `docs/harness-expansion/inventory.md` and this table.

Do not guess model names or output formats. Verify them against the installed CLI's help output and official documentation.
See `docs/harness-expansion/README.md` for the 6-phase expansion plan (P01–P06) and `docs/harness-expansion/inventory.md` for per-harness probe results.
