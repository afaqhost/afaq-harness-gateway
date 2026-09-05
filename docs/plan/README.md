# Plan Index — Phased Implementation (Image Upload Excluded)

> **Entry point for multi-session work.** Start here, then open the next unchecked phase file.

**Baseline:** `main` at `aa95dd8` — 96 tests green, layered architecture done.  
**Scope:** All `AFQAUDIT.md` critical gaps **except `uploads_dir` / image input** (explicitly excluded per request).  
**How to resume:** Find first unchecked `- [ ]` in the global checklist at the bottom of this file, `cd` into its `phase-*.md`, follow its `## 4. Detailed Tasks` in order, run its `## 6. Tests` after each task.

---

## Phase Files (8 Sessions, 2–4h each)

| # | File | Title | Effort | Depends | Status |
|---|---|---|---|---|---|
| 01 | [phase-01-security-rate-limiting.md](phase-01-security-rate-limiting.md) | Security Hardening & Rate Limiting | 3h | — | ✅ Done (116 tests) |
| 02 | [phase-02-cancel-process-lifecycle.md](phase-02-cancel-process-lifecycle.md) | Cancel & Process Lifecycle | 3h | S1 | ✅ Done (127 tests) |
| 03 | [phase-03-usage-pagination-archive.md](phase-03-usage-pagination-archive.md) | Usage History, Pagination & Archive | 3h | — | ✅ Done (141 tests) |
| 04 | [phase-04-sse-completeness.md](phase-04-sse-completeness.md) | SSE Completeness (IDs, Heartbeats, Reconnect) | 3h | S2 | ✅ Done (148 tests) |
| 05 | [phase-05-harness-lifecycle-health.md](phase-05-harness-lifecycle-health.md) | Harness Lifecycle & Health | 3h | S1 | ✅ Done (160 tests) |
| 06 | [phase-06-credential-profiles.md](phase-06-credential-profiles.md) | Credential Profiles (wire `encrypt_secret`) | 3h | S5 | ✅ Done (173 tests) |
| 07 | [phase-07-tool-calling-structured-output.md](phase-07-tool-calling-structured-output.md) | Tool Calling & Structured Output | 4h | S4 | ✅ Done (189 tests) |
| 08 | [phase-08-polish-observability.md](phase-08-polish-observability.md) | Polish: Key Rotation, Errors, Observability | 3h | S1–S7 | ✅ Done (204 tests) |

**Combined:** See `../IMPLEMENTATION_PLAN.md` for the original 8-session table and resumption principles (`## 0. Principles & How to Resume`).

---

## Global Progress

Copy this to your PR description and check as you merge:

```markdown
- [x] S1 Security & Rate Limit (`phase-01`)
- [x] S2 Cancel & Lifecycle (`phase-02`)
- [x] S3 Usage/Pagination/Archive (`phase-03`)
- [x] S4 SSE Completeness (`phase-04`)
- [x] S5 Harness Lifecycle & Health (`phase-05`)
- [x] S6 Credential Profiles (`phase-06`)
- [x] S7 Tool Calling (`phase-07`)
- [x] S8 Polish (`phase-08`)
```

---

## Per-Phase Quick Verify

After finishing a phase's tasks:

```bash
.venv/bin/python -m compileall -q app
.venv/bin/python -m pytest -q                               # all 96+ new
.venv/bin/python -m pytest -m unit -q
.venv/bin/python -m pytest -m integration -q
.venv/bin/python -m pytest -m e2e -q
.venv/bin/python -m pytest -m security -q
.venv/bin/python -m pytest -m performance -q
.venv/bin/python -m pytest -m contract -q
```

Each phase file's `## 7. Verification & Exit` lists its specific `curl` checks (e.g., `429` after 6th request for S1, `Last-Event-ID` replay for S4, `POST /cancel` kill for S2).

---

## Excluded (Future Plan)

- **Image/file upload:** `POST /files`, `GET /files/{id}`, `uploads_dir` lifecycle, MIME allow-list, virus scan. `app/core/config.py:19` stays unused until a dedicated `docs/plan/phase-09-file-upload.md` is created.

---

## File Map Quick Ref

- Wiring: `app/main.py:22`, `app/config/settings.py`, `app/core/config.py:14`
- Auth: `app/api/auth.py:27`, `app/api/openai.py:47` `resolve_identity`
- Chat: `app/api/chat.py:104`, `app/repositories/conversation_repository.py:15`, `app/services/model_service.py:45`
- Clients: `app/clients/base.py:58`, `app/clients/claude.py:8`, `app/clients/registry.py:20`
- DB: `app/db/database.py:14` (`User`, `APIKey`, `Conversation`, `UsageRecord`)

---

*All 8 phases done — 204 tests green. Excludes image upload per request.*
