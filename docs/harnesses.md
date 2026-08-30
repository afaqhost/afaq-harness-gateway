# Harness Integrations

Harnesses are local CLI adapters defined in `app/harnesses/registry.py`. The gateway checks whether each executable is available on `PATH`, discovers models, builds a command, and parses the command output.

## Supported Adapters

| Harness | Executable | Installation recipe in the adapter | Model discovery |
| --- | --- | --- | --- |
| Codex | `codex` | `npm install -g @openai/codex` | Reads `~/.codex/models_cache.json`, with a fallback list |
| OpenCode | `opencode` | `npm install -g opencode-ai` | Runs `opencode models` |
| Command Code | `cmd` | `npm install -g command-code` | Runs `cmd --list-models` |
| Claude Code | `claude` | `npm install -g @anthropic-ai/claude-code` | Uses the adapter's standard Claude model names when installed |

Install and authenticate each CLI through its official documentation. The gateway does not proxy or replace a harness provider's login flow.

## Model Names

Use the model identifier returned by `GET /v1/models`. Examples include:

```text
codex//gpt-5.6-terra
opencode//opencode/big-pickle
commandcode//claude-sonnet-4-6
```

The first segment selects the adapter. The adapter receives the remaining model value.

## Refreshing Models

Models are loaded when the server starts. To refresh after installing a CLI, changing credentials, or changing provider configuration:

1. Open the dashboard's **Harnesses** page.
2. Select **Refresh models**.
3. Return to **Chat** and choose the updated model list.

The refresh endpoint is `POST /api/admin/harnesses/refresh` and requires dashboard authentication.

## Adding a Harness

1. Add a `HarnessAdapter` implementation in `app/harnesses/registry.py`.
2. Set `name`, `display_name`, and `executable`.
3. Implement `build_command()`.
4. Implement `parse_line()` for streaming output and `parse_output()` when non-streaming output needs normalization.
5. Implement `list_models()` with the CLI's actual discovery mechanism.
6. Add the adapter instance to `ADAPTERS`.
7. Test installation detection, model discovery, non-streaming output, streaming output, and non-zero exit handling.

Do not guess model names or output formats. Verify them against the installed CLI's help output and official documentation.
