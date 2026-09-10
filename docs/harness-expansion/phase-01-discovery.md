# Phase 01 — Discovery & Inventory (Agy, Minimax, Pi + delegate-skills)

> **Goal:** Verify every CLI from `https://github.com/amElnagdy/delegate-skills` + `minimax`, capture `executable`, `install`, `help`, `model discovery` and decide Generic vs Custom.
> **Entry:** `main` at `2a472d9`, 4 adapters done.
> **Exit:** `docs/harness-expansion/inventory.json` or table updated, Generic vs Custom map decided, next phase can start without guessing.

## Tasks

- [ ] **P01.1 Fetch delegate-skills inventory** — Open each `skills/*-delegate/SKILL.md` in source repo, copy:
  - `executable` (e.g., `agy`, `pi`, `cursor-agent`, `oz` for warp, `qodercli`, `zcode`)
  - `install_command` (`npm i -g ...` / `pip` / binary)
  - `model flag` (`--model provider/model` or `--model` required)
  - `read-only flag` (`--read-only` → `plan` / `plan mode` / `dry-run` / no flag)
  - `resume flag` (`--session`, `--resume-last`, `--continue`, `--conversation`)
  Store in `docs/harness-expansion/inventory.md` table.

- [ ] **P01.2 Probe executables on target host** — On `192.168.0.194` and local dev:
  ```bash
  for exe in agy pi minimax minimax-cli kimi grok cline cursor-agent omp qodercli vibe copilot oz zcode aider; do which $exe; $exe --help 2>&1 | head -n 30; echo "---"; done
  ```
  Record which are installed (`shutil.which` `app/clients/base.py:33`) and which return `127`.

- [ ] **P01.3 Resolve `minimax` ambiguity** — `minimax` not in delegate-skills table. Probe:
  ```bash
  minimax --help; minimax-cli --help; npx minimax --help; npm view minimax-cli 2>&1 | head
  ```
  If no CLI, mark as `GenericAdapter` placeholder with `executable=minimax` and document `TODO: confirm install`.

- [ ] **P01.4 Decide Generic vs Custom per harness** — Rule:
  - **Generic** if CLI accepts `"{prompt}"` + `"{model}"` via simple `command_template` and JSON output is just `text` (no tool_call streaming).
  - **Custom** if CLI needs special `parse_line` for `tool_call`/`stream-json` (e.g., `agy` has `permissions`, `pi` streams JSON with `type: text`, `kimi` stream-json, `grok` streaming-json). Mark `pi`, `agy`, `kimi`, `grok`, `cline`, `cursor`, `copilot`, `warp`, `zcode` as Custom; rest as Generic initially.

- [ ] **P01.5 Draft command templates** — For each, write expected `build_command`:
  ```text
  agy: ["agy","--print","{prompt}","--model","{model}"] + plan flag if verified
  pi:  ["pi","--print","{prompt}"]  # pi has no model flag? check help
  minimax: ["minimax","--print","{prompt}","--model","{model}"]
  ```
  Keep in `inventory.md` — do not implement yet.

- [ ] **P01.6 Update README tracker** — Check box in `docs/harness-expansion/README.md` P01 when done, commit `docs: harness inventory P01`.

## Verification

```bash
cat docs/harness-expansion/inventory.md
python -m compileall -q app && echo ok
```

## Deliverables

- `docs/harness-expansion/inventory.md` (or `.json`) with 18 rows, each with `executable`, `installed?`, `install`, `help snippet`, `Generic/Custom` decision.
- No code changes yet — only docs.

## Next

→ `phase-02-generic-bulk.md` (wire Generic adapters)
