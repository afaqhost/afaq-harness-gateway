# Harness Expansion Plan — Multi-Session (Agy, Minimax, Pi + delegate-skills)

> **Source:** `https://github.com/amElnagdy/delegate-skills` — 17 `*-delegate` skills (see `docs/harnesses.md:8` for current 4)
> **Goal:** Expose every delegate-skills CLI as `harness` via `app/clients/registry.py:20` → `GET /v1/models` + `POST /v1/chat/completions` (OpenAI-compatible) with isolated `cwd` `app/clients/base.py:92`
> **Style:** Same as `docs/IMPLEMENTATION_PLAN.md` — resumable phases, each 2–4h, ends with `pytest -q` green.

## Inventory (delegate-skills → harness)

| Requested | Executable | Status in Gateway | Install recipe | Notes |
|---|---|---|---|---|
| `agy` | `agy` | **DONE** `app/clients/agy.py` | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` (not npm) | Google Antigravity — plan mode via `--mode plan` |
| `minimax` | `minimax` / `minimax-cli` | **DONE** `GenericAdapter` `minimax` | `npm i -g minimax-cli` | Not in delegate-skills table — Generic placeholder, `minimax --list-models` fallback |
| `pi` | `pi` | **DONE** `app/clients/pi.py` | `npm i -g pi` (earendil-works/pi-mono) | `pi` — `read,grep,find,ls` via cwd + `--mode json` |
| `aider` | `aider` | **DONE** `GenericAdapter` | `pip install aider-chat` | `--no-auto-commits --no-dirty-commits`, `--read-only` = `--dry-run` |
| `cline` | `cline` | **DONE** `GenericAdapter` | `npm i -g @cline/cli` | `cline --plan --auto-approve false` |
| `cursor` | `cursor-agent` | **DONE** `GenericAdapter` | `cursor-agent` binary | `--force` vs plan mode |
| `grok` | `grok` | **DONE** `GenericAdapter` | `npm i -g grok` | `grok` Build — best-effort read-only |
| `kimi` | `kimi` | **DONE** `GenericAdapter` | `npm i -g @moonshot/kimi-code` | `kimi -p` headless `--prompt=` |
| `omp` | `omp` | **DONE** `GenericAdapter` | `omp` binary | `omp --mode json --yolo` |
| `qoder` | `qodercli` | **DONE** `GenericAdapter` | `qodercli` | `auto` permission |
| `vibe` | `vibe` | **DONE** `GenericAdapter` | `vibe` | `accept-edits` |
| `copilot` | `copilot` | **DONE** `GenericAdapter` | `npm i -g @github/copilot` | `--allow-all-tools` |
| `warp` | `oz` | **DONE** `GenericAdapter` | `oz` | Warp Agent `oz` |
| `zcode` | `zcode` | **DONE** `GenericAdapter` | `zcode` (bundled app) | `zcode --mode plan/yolo` |
| `claude` | `claude` | **DONE** `app/clients/claude.py` |  |  |
| `codex` | `codex` | **DONE** `app/clients/codex.py` |  |  |
| `commandcode` | `cmd` | **DONE** `app/clients/commandcode.py` |  |  |
| `opencode` | `opencode` | **DONE** `app/clients/opencode.py` |  |  |

> **Already covered:** 18/18. **Remaining:** 0 — all harnesses wired (2 Custom + 12 Generic, 4 original).
> Implemented: `app/clients/registry.py:20` now 18 entries, `GET /health` 18, `app/clients/agy.py` + `pi.py` with `list_models` verified via `agy models` / `pi --list-models`.

## Phase Index — Jump to any file, resume from first unchecked box

| Phase | File | Focus | Effort | Depends |
|---|---|---|---|---|
| **P01** | `phase-01-discovery.md` | Inventory, verify executables, help output, decide Generic vs Custom | 2h | — |
| **P02** | `phase-02-generic-bulk.md` | Bulk `GenericAdapter` wiring for 14 harnesses (agy, minimax, pi first) | 3h | P01 |
| **P03** | `phase-03-custom-adapters.md` | Custom `build_command`/`parse_line` for tool calls & streaming (agy, pi, kimi, grok...) | 4h | P02 |
| **P04** | `phase-04-model-discovery.md` | `list_models()` per harness + `MODEL_CACHE`/`refresh_models` + health | 3h | P02 |
| **P05** | `phase-05-testing-integration.md` | Unit + integration + contract: `/v1/models`, `/v1/chat/completions`, SSE tool events | 3h | P03,P04 |
| **P06** | `phase-06-docs-dashboard.md` | `docs/harnesses.md`, `GET /health`, dashboard, `make check` | 2h | P05 |

**Total:** ~17h across 6 resumable sessions.

## How to Resume

1. Open this file → pick first phase with unchecked `- [ ]`.
2. Read its `phase-0X-*.md` fully (Entry/Tasks/Exit).
3. Work in branch `feat/harness-phase-0X` from `main` (or continue current branch).
4. After each sub-task: `python -m compileall -q app && .venv/bin/python -m pytest -q`.
5. At phase end: commit, check box here, push.

## Progress Tracker

- [x] P01 Discovery — executables verified, Generic vs Custom map decided (`docs/harness-expansion/inventory.md` 2026-09-10)
- [x] P02 Generic Bulk — 14 adapters registered, `GET /v1/models` returns new `id`s (`app/clients/registry.py:20` 18 entries)
- [x] P03 Custom Adapters — `parse_line` tool calls + `--read-only` flags (`app/clients/agy.py`, `app/clients/pi.py`)
- [x] P04 Model Discovery — `list_models` + `refresh_models` + `is_installed` green (`agy models` / `pi --list-models` verified)
- [x] P05 Testing — `POST /v1/chat/completions` stream/non-stream for each new harness (mocked) — `tests/integration/test_health.py:18` updated to dynamic count, 204 pass
- [x] P06 Docs & Dashboard — `docs/harnesses.md` + `GET /health` updated, 204+ tests green

## Base Verification (run after every phase)

```bash
python -m compileall -q app
.venv/bin/python -m pytest -q            # expect 204 + new
.venv/bin/python -m pytest -m unit -q
.venv/bin/python -m pytest -m integration -q
curl http://127.0.0.1:3500/v1/models | jq
curl -H "Authorization: Bearer afaq_..." -d '{"model":"agy//...","messages":[{"role":"user","content":"hi"}]}' http://127.0.0.1:3500/v1/chat/completions
```

## Risks & Notes

- **Unknown `minimax` executable:** Verify `minimax --help` / `minimax-cli --help` on target host; if missing, ship as `GenericAdapter` with placeholder and document.
- **No permission modes (pi, warp, aider):** Rely on `cwd` isolation `app/clients/base.py:92` + prompt `Do NOT write files` — cannot enforce via CLI flag; review `git diff` post-run.
- **`MODEL_CACHE` sharing:** Use `seed_models` fixture per test `tests/integration/test_chat_integration.py:6`.
- **Windows shims (cmdc, omp.exe):** Verify `shutil.which` `app/clients/base.py:33` resolves correctly; add `.cmd` fallback if needed.

*Last updated: 2026-09-10 — branch `main` at expansion (18 harnesses, 204 tests green, `app/clients/registry.py:20` P02–P04 done).*
