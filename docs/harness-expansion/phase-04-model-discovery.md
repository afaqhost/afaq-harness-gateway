# Phase 04 — Model Discovery & Health

> **Goal:** Each new harness exposes `list_models()` and `is_installed()` correctly; `refresh_models` `app/clients/registry.py:75` caches them; `GET /v1/models` and `GET /health` reflect reality.
> **Entry:** Adapters wired (P02/P03), but `list_models` may still return `[]`.
> **Exit:** `GET /v1/models` shows `agy//...`, `pi//...`, `minimax//...` when CLI installed; `GET /health` shows `installed: true/false` per harness.

## Tasks

- [ ] **P04.1 Implement `list_models()` per harness** — Check how each CLI lists models:
  - `agy` → `agy models` or `agy --list-models` (probe).
  - `pi` → `pi models` (or static list like `claude.py:44` if no command).
  - `minimax` → `minimax --list-models` or static `["minimax-m2"]`.
  - `kimi` → `kimi --help` may show provider/model format.
  - For unknown, fallback to `return []` `base.py:68` (dashboard will show 0 models, not error) — like `claude.py:44` static list.
  Example:
  ```python
  async def list_models(self):
      proc = await asyncio.create_subprocess_exec(self.executable, "--list-models", stdout=PIPE, stderr=PIPE)
      stdout,_ = await asyncio.wait_for(proc.communicate(), timeout=30)
      if proc.returncode!=0: return []
      return [HarnessModel(f"{self.name}//{m}", self.name, m.split("/")[0], m) for m in stdout.decode().splitlines() if "/" in m]
  ```
  Copy pattern from `commandcode.py:84` or `opencode.py:47`.

- [ ] **P04.2 Wire `is_installed()`** — Default `shutil.which(self.executable)` `base.py:33` is enough. For `warp` (`oz`) or `cursor-agent.cmd` on Windows, test fallback with `.cmd` extension.

- [ ] **P04.3 Test `refresh_models` + `MODEL_CACHE`** — `registry.py:75` already loops `all_adapters()` and `is_installed()` check. No code change, but verify after `POST /api/admin/harnesses/refresh` (dashboard).

- [ ] **P04.4 Health integration** — `app/main.py:124` `GET /health` already iterates `all_adapters()` and `is_installed()`. No code change, but verify new harnesses appear in `harnesses: [{name, installed}]`.

- [ ] **P04.5 Handle `minimax` placeholder** — If `minimax` CLI not found, `list_models` returns `[]` or static `["default"]` like `codex.py:55` so `POST /v1/chat/completions` with `minimax//default` still works via `GenericAdapter` command.

## Verification

```bash
# install one harness
curl -fsSL https://antigravity.google/cli/install.sh | bash  # agy is not on npm
curl -X POST http://127.0.0.1:3500/api/admin/harnesses/refresh -H "Authorization: Bearer <JWT>"
curl http://127.0.0.1:3500/v1/models | jq '.data[] | .id' | grep -E "agy|pi|minimax"
curl http://127.0.0.1:3500/health | jq
.venv/bin/python -m pytest -q -k "test_health or test_harness_adapters"
```

## Deliverables

- Each new `app/clients/<name>.py` has working `list_models()` (or static fallback).
- `GET /v1/models` contract still holds: `object:"list"`, `data[].object=="model"` `tests/contract/test_api_contract.py:18`.

## Next

→ `phase-05-testing-integration.md`
