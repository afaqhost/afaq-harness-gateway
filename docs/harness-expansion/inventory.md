# Harness Inventory — P01 Discovery (2026-09-10)

> Probe run at `2026-09-10` on host `nasser-desktop` (`which` + `--help` + `shutil.which` via `app/clients/base.py:33`).
> Branch: `main` at `2a472d9` before expansion.

## Installed on dev host

| Harness (delegate skill) | Requested exec | Found exec | `is_installed()` | `help` snippet | Models command | Notes |
|---|---|---|---|---|---|---|
| `claude` | `claude` | `/home/nasser/.npm-global/bin/claude` | true | `claude [options] [command] [prompt] --print stream-json --permission-mode plan` | static list `default, sonnet, opus, haiku` | Custom adapter already `app/clients/claude.py` |
| `codex` | `codex` | `/home/nasser/.npm-global/bin/codex` | true | `codex exec --json --skip-git-repo-check --sandbox read-only` | reads `~/.codex/models_cache.json` | Custom `app/clients/codex.py` |
| `opencode` | `opencode` | `/home/nasser/.npm-global/bin/opencode` | true | `opencode run --format json --model <provider/model>` | `opencode models` | Custom `app/clients/opencode.py` |
| `commandcode` | `cmd` (dep `commandcode`) | `/home/nasser/.npm-global/bin/cmd` | true | `cmd --print "msg" --output-format json --permission-mode plan --yolo` | `cmd --list-models` | Custom `app/clients/commandcode.py` |
| `agy` | `agy` | `/home/nasser/.local/bin/agy` | true | `agy --print="prompt" --model <label> --output-format text|json|stream-json --mode plan|accept-edits` | `agy models` (tabular `gemini-*`) | Google Antigravity; relay uses `--print=<brief>` + `--add-dir` |
| `pi` | `pi` | `/home/nasser/.npm-global/bin/pi` | true | `pi -p "prompt" --mode json --model <pattern> --tools read,grep,...` | `pi --list-models` (table `provider model ...`) | Earendil pi-mono; JSON output is NDJSON `{"type":"message_update",...}` with `text_delta` |

## Not installed (generic placeholder until CLI present)

| Harness | Exec | Expected install | Expected `build_command` shape | Expected list_models | Read-only flag | Notes |
|---|---|---|---|---|---|---|
| `minimax` | `minimax` | `npm i -g minimax-cli` (verify) OR `minimax` | `["minimax","--print","{prompt}","--model","{model}"]` | `minimax --list-models` else static `["minimax-m2"]` | best-effort (cwd isolation) | Not in delegate-skills table; ship as Generic placeholder |
| `kimi` | `kimi` | `npm i -g @moonshot/kimi-code` OR brew `kimi-code` | `["kimi","-m","{model}","--prompt={prompt}","--output-format","stream-json"]` (relay: `--prompt=<brief>`) | `kimi --help` (check) | none — always auto-approve (relay: no `--yolo` distinction) | Headless `-p` has no read-only |
| `grok` | `grok` | `npm i -g @xai-official/grok` | `grok --prompt-file <file> --output-format streaming-json --model ...` → generic `["grok","--print","{prompt}","--model","{model}"]` best-effort | `grok version` | `--sandbox read-only --permission-mode plan` best-effort | Requires `XAI_API_KEY` |
| `cline` | `cline` | `npm i -g @cline/cli` | `["cline","--print","{prompt}","--model","{model}"]` | `cline --help` | `cline --plan --auto-approve false` | |
| `cursor` | `cursor-agent` | `cursor-agent` binary | `["cursor-agent","--print","{prompt}","--model","{model}"]` | static if no list | `--force` vs plan | Windows: `cursor-agent.cmd` shim |
| `copilot` | `copilot` | `npm i -g @github/copilot` | `["copilot","--print","{prompt}","--model","{model}"]` | `copilot --list-models`? | `--allow-all-tools` negation | |
| `warp` | `oz` | `oz` (Warp Agent) | `["oz","--print","{prompt}","--model","{model}"]` | `oz --help` | none (best-effort cwd) | Warp Agent executable is `oz` |
| `zcode` | `zcode` | `zcode` bundled app | `["zcode","--print","{prompt}","--mode","plan","--model","{model}"]` | `zcode --mode plan` | `--mode plan / yolo` | |
| `aider` | `aider` | `pip install aider-chat` | `["aider","--message","{prompt}","--model","{model}","--no-auto-commits","--no-dirty-commits"]` | static `["default"]` | `--dry-run` for read-only | |
| `omp` | `omp` | `omp` binary (npm?) | `["omp","--print","{prompt}","--model","{model}"]` | `omp --help` | n/a | Also `omc`? keep `omp` per docs |
| `qoder` | `qodercli` | `qodercli` | `["qodercli","--print","{prompt}","--model","{model}"]` | `qodercli --help` | `auto` permission | |
| `vibe` | `vibe` | `vibe` | `["vibe","--print","{prompt}","--model","{model}"]` | `vibe --help` | `accept-edits` | |

## Decision: Generic vs Custom

- **Custom now (implement `build_command`/`parse_line`/`list_models`):** `agy`, `pi` (installed, non-trivial JSON streaming, need correct flags and parsing). Also upgrade later: `kimi`, `grok`, `cline`, `cursor`, `copilot`, `warp`, `zcode` when help confirms tool_call shape — initially Generic is safe because `base.py:75` `parse_line` returns `line,{}` for text-only.
- **Generic (text-only) until proven otherwise:** `minimax`, `aider`, `omp`, `qoder`, `vibe` (no tool_call streaming known, simple prompt+model args). They already pass `GET /v1/models` (empty when not installed) and `POST /v1/chat/completions` via `cwd` isolation `app/clients/base.py:92`.

## Command templates (for `GenericAdapter.command_template` in `app/clients/registry.py`)

```
agy: ["agy","--print={prompt}","--output-format","json","--mode","plan"] + optional ["--model","{model}"] if model != default
pi:  ["pi","-p","{prompt}","--mode","json"] + optional ["--model","{model}"]
minimax: ["minimax","--print","{prompt}","--model","{model}"]
aider: ["aider","--message","{prompt}","--model","{model}","--no-auto-commits","--no-dirty-commits"]
cline: ["cline","--print","{prompt}","--model","{model}"]
cursor: ["cursor-agent","--print","{prompt}","--model","{model}"]
grok: ["grok","--print","{prompt}","--model","{model}"]
kimi: ["kimi","-m","{model}","--prompt={prompt}","--output-format","stream-json"]
omp: ["omp","--print","{prompt}","--model","{model}"]
qoder: ["qodercli","--print","{prompt}","--model","{model}"]
vibe: ["vibe","--print","{prompt}","--model","{model}"]
copilot: ["copilot","--print","{prompt}","--model","{model}"]
warp: ["oz","--print","{prompt}","--model","{model}"]
zcode: ["zcode","--print","{prompt}","--mode","plan","--model","{model}"]
```

> For `agy` the real relay uses `--print=<brief>` (equals form) to avoid `--help` confusion. Generic template using `--print={prompt}` is equivalent (no shell). For `kimi` similarly `--prompt=<brief>`. Templates are validated against `which` probe above — no guessing before `P02`.

## Next

- P02: wire all 14 via `GenericAdapter` in `app/clients/registry.py:20` (later replace `agy`/`pi` with Custom).
- P03: replace `agy`/`pi` Generic entries with `AgyAdapter`/`PiAdapter`.
- P04: implement `list_models()` per custom adapter (agy: `agy models`, pi: `pi --list-models`).
