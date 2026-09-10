# Phase 03 — Custom Adapters (Tool Calls, Streaming, Read-Only)

> **Goal:** Replace `GenericAdapter` with full `HarnessAdapter` where CLI needs special JSON streaming or permission flags.
> **Entry:** P02 bulk works for text, but `tool_call` and `--read-only` missing.
> **Exit:** `POST /v1/chat/completions` with `tools` returns `tool_calls` for agy/pi/kimi etc., and `--permission-mode plan`/`--read-only`/`--dry-run` enforced where supported.

## Tasks

- [ ] **P03.1 Audit which need custom `parse_line`** — From `skills/*-delegate/SKILL.md` and `app/clients/*.py: parse_line` examples:
  - `agy` — check `agy --help` for JSON event shape (likely `{"type":"tool_call",...}`).
  - `pi` — `pi` JSON: `{"type":"text","part":{"text":...}}` similar to `opencode.py:39` or plain line.
  - `kimi` — `kimi` headless `-p` stream-json (check `kimi --help`).
  - `grok` — `grok` streaming-json report.
  - `cline` — `cline` JSON with `type: tool_call`.
  - `cursor` — `cursor-agent` NDJSON with `type: tool_call`.
  - `copilot` — `copilot` event shape with `tool_call`.
  - `warp` (`oz`) — `run_started` → `runId`, `conversation_started` → `conversationId`.
  - `zcode` — `zcode --mode plan` JSON.
  Mark those as Custom; keep `aider`, `omp`, `qoder`, `vibe`, `minimax` as Generic if simple.

- [ ] **P03.2 Create files `app/clients/<name>.py`** — One per Custom (copy `app/clients/codex.py:14` as template):
  ```python
  class AgyAdapter(HarnessAdapter):
      name, display_name, executable = "agy", "Google Antigravity", "agy"
      install_command = ["npm","install","-g","@google/agy"]
      def build_command(self, prompt, model=None, session_id=None):
          cmd = [self.executable, "--print", prompt, "--output-format","json", "--permission-mode","plan"]
          if model and model!="default": cmd+=["--model", model]
          if session_id: cmd+=["--resume", session_id]  # or --conversation per SKILL.md
          return cmd
      def parse_line(self, line, model):
          try: item=json.loads(line)
               if item.get("type")=="tool_call": return "", {"tool_call": normalize(item)}
               return item.get("text",""), {}
          except: return line, {}
  ```
  Do for each Custom; keep `build_command` verified against `*.py:14` help.

- [ ] **P03.3 Add read-only flags per SKILL.md** — Map:
  - `agy` → `--read-only` (plan), `claude` already `plan` `claude.py:13`, `codex` already `read-only` `codex.py:14`, `commandcode` `plan` `commandcode.py:23`, `opencode` relies on `cwd` `base.py:92`, `aider` → `--dry-run`, `pi` → `read,grep,find,ls` (no flag, rely on `cwd`), `copilot` → `--mode plan`, `warp` → no flag (best-effort), `zcode` → `--mode plan`.

- [ ] **P03.4 Replace Generic entries in `registry.py:20`** — Swap:
  ```python
  from app.clients.agy import AgyAdapter
  ADAPTERS["agy"] = AgyAdapter()  # instead of GenericAdapter
  ```

- [ ] **P03.5 Verify tool parsing matches `docs/api.md:83`** — `POST /v1/chat/completions` with `tools: [{type:"function",...}]` should yield `choices[0].message.tool_calls` `openai.py:456`. Test with mocked `parse_line` returning `{"tool_call":...}`.

## Verification

```bash
python -m compileall -q app
.venv/bin/python -m pytest -q -k "test_tool_parsing or test_tool_contract"
# manual: send tool request via curl to agy/pi
curl -H "Authorization: Bearer afaq_..." -d '{"model":"agy//...","messages":[{"role":"user","content":"list files"}],"tools":[{"type":"function","function":{"name":"ls"}}]}' http://127.0.0.1:3500/v1/chat/completions | jq
```

## Deliverables

- `app/clients/agy.py`, `pi.py`, `kimi.py`, etc. (only for those needing custom).
- `app/clients/registry.py` updated to use Custom adapters.

## Next

→ `phase-04-model-discovery.md`
