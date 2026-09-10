# Phase 06 — Docs & Dashboard

> **Goal:** Update docs and dashboard so new harnesses are discoverable (like existing 4).
> **Entry:** Adapters + tests green.
> **Exit:** `docs/harnesses.md` lists all 18, `GET /health` and dashboard `Harnesses` page show new entries, `make check` green.

## Tasks

- [ ] **P06.1 Update `docs/harnesses.md:8`** — Add rows to table:
  ```markdown
  | Agy (Antigravity) | `agy` | `npm i -g @google/agy` | `agy --list-models` |
  | Pi | `pi` | `npm i -g pi` | `pi models` |
  | Minimax | `minimax` | `npm i -g minimax-cli` | `minimax --list-models` |
  | ... (aider, cline, cursor, grok, kimi, omp, qoder, vibe, copilot, warp, zcode) |
  ```
  Also update `Model Names` examples `harnesses.md:18` with `agy//...`, `pi//...`.

- [ ] **P06.2 Dashboard** — No code change if `GET /health` `app/main.py:124` and `POST /api/admin/harnesses/refresh` already generic over `all_adapters()` `registry.py:156`. Verify UI shows new harnesses (sidebar, `GET /api/admin/harnesses` if exists).

- [ ] **P06.3 Update `docs/api.md:11`** — Note new `owned_by` values (`agy`, `pi`, `minimax` etc.) in `GET /v1/models` example.

- [ ] **P06.4 README** — If `README.md:15` lists harnesses, update count from 4 to 18 or keep generic “multiple harnesses”.

- [ ] **P06.5 Run full gates** — `make check` `README.md:74`:
  ```bash
  make check  # compileall + node --check + pytest -q (now ~220+ tests)
  curl http://127.0.0.1:3500/health | jq
  curl http://127.0.0.1:3500/v1/models | jq '.data | length'
  ```

- [ ] **P06.6 Check progress tracker** — Mark P06 done in `docs/harness-expansion/README.md` tracker, commit `docs: harness expansion complete`.

## Verification

```bash
python -m compileall -q app
.venv/bin/python -m pytest -q  # expect >204
cat docs/harnesses.md
curl http://127.0.0.1:3500/health | jq '.harnesses | map(.name)'
```

## Deliverables

- `docs/harnesses.md` updated, dashboard shows new harnesses, no regression.
- Final commit, ready for next expansion (file upload etc. still excluded).

## Done

All 6 phases complete — Gateway now exposes every delegate-skills CLI + minimax as OpenAI-compatible model via isolated `cwd`.
