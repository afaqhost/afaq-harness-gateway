# Phase 02 — Bulk Generic Adapters (Agy, Minimax, Pi First)

> **Goal:** Register remaining 14 harnesses via `GenericAdapter` so `GET /v1/models` and `POST /v1/chat/completions` work immediately (even before custom parsing).
> **Entry:** P01 inventory done, Generic vs Custom map known.
> **Exit:** `GET /v1/models` returns `agy//...`, `pi//...`, `minimax//...` etc. when installed; `POST /v1/chat/completions` with `model: "agy//..."` reaches harness via `cwd` isolation `app/clients/base.py:92`.

## Tasks

- [ ] **P02.1 Create generic wiring in `app/clients/registry.py:20`** — No new files yet:
  ```python
  from app.clients.generic import GenericAdapter
  ADAPTERS: dict[str, HarnessAdapter] = {
    "claude": ClaudeAdapter(),
    "codex": CodexAdapter(),
    "opencode": OpenCodeAdapter(),
    "commandcode": CommandCodeAdapter(),
    # P02 bulk
    "agy": GenericAdapter(name="agy", executable="agy", provider="google", command_template=["agy","--print","{prompt}","--model","{model}"]),
    "pi": GenericAdapter(name="pi", executable="pi", provider="pi", command_template=["pi","{prompt}"]),
    "minimax": GenericAdapter(name="minimax", executable="minimax", provider="minimax", command_template=["minimax","--print","{prompt}","--model","{model}"]),
    "aider": GenericAdapter(name="aider", executable="aider", command_template=["aider","--message-file","{prompt}","--no-auto-commits","--no-dirty-commits"]),
    "cline": GenericAdapter(name="cline", executable="cline", command_template=["cline","--print","{prompt}"]),
    "cursor": GenericAdapter(name="cursor", executable="cursor-agent", command_template=["cursor-agent","--print","{prompt}"]),
    "grok": GenericAdapter(name="grok", executable="grok", command_template=["grok","--print","{prompt}"]),
    "kimi": GenericAdapter(name="kimi", executable="kimi", command_template=["kimi","-p","{prompt}"]),
    "omp": GenericAdapter(name="omp", executable="omp", command_template=["omp","--print","{prompt}"]),
    "qoder": GenericAdapter(name="qoder", executable="qodercli", command_template=["qodercli","--print","{prompt}"]),
    "vibe": GenericAdapter(name="vibe", executable="vibe", command_template=["vibe","--print","{prompt}"]),
    "copilot": GenericAdapter(name="copilot", executable="copilot", command_template=["copilot","--print","{prompt}"]),
    "warp": GenericAdapter(name="warp", executable="oz", command_template=["oz","--print","{prompt}"]),
    "zcode": GenericAdapter(name="zcode", executable="zcode", command_template=["zcode","--print","{prompt}"]),
  }
  ```
  Adjust `command_template` per P01 help output — `{prompt}` and `{model}` are replaced in `generic.py:42`.

- [ ] **P02.2 Add install/update recipes (optional)** — If `GenericAdapter` needs `install_command`, set per harness:
  ```python
  GenericAdapter(name="agy", executable="agy", install_command=["npm","install","-g","@google/agy"])
  ```
  Or leave empty (manual install) and document in `docs/harnesses.md`.

- [ ] **P02.3 Prioritize agy, minimax, pi** — Test those three first; others can stay `is_installed() == False` until CLI present — `refresh_models` `registry.py:82` already handles `not installed → []`.

- [ ] **P02.4 Smoke test `is_installed` + registry** — Unit: `assert "agy" in ADAPTERS` `assert get_adapter("pi").executable == "pi"`.

- [ ] **P02.5 Manual verification** — After restart:
  ```bash
  curl http://127.0.0.1:3500/v1/models | jq '.data[] | select(.id|startswith("agy//") or startswith("pi//"))'
  # if not installed, expect [] — not error
  ```

## Verification

```bash
python -m compileall -q app
.venv/bin/python -m pytest -q -k "test_harness_adapters or test_model_utils"  # should still 204
curl http://127.0.0.1:3500/v1/models | jq length
```

## Deliverables

- `app/clients/registry.py` with 14 new `GenericAdapter` entries.
- No custom `parse_line` yet — `base.py:75` default `return line, {}` is fine for text-only.

## Risks

- **Wrong `command_template`:** If `pi` expects `stdin` not `arg`, run will fail with `harness_error` 502 — fix in P03 with custom adapter.
- **Windows shim:** `cursor-agent.cmd` etc. may need `shutil.which` fallback — already handled `base.py:33`.

## Next

→ `phase-03-custom-adapters.md` (add `parse_line` + read-only flags)
