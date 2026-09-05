# Phase 05 — Harness Lifecycle & Health

**Session ID:** `S5` · **Effort:** 3h · **Risk:** Medium · **Depends:** S1  
**Goal:** `install`/`update`/`health` are real, not stubs; model cache has freshness.

---

## 1. Why

`app/api/admin.py:41` `install_harness` returns hardcoded `{"status":"accepted","message":"Use the installation stream..."}` — never calls `adapter.install()` `app/clients/base.py:21`. `GET /health` `app/main.py:62` only checks gateway, not per-harness `is_installed()`/`list_models()` latency. `AFQAUDIT.md:155` flags lifecycle as *Missing*.

**Files:**

- `app/api/admin.py:41-44` `install_harness` stub
- `app/clients/base.py:21-41` `install`/`update` (already correct, just not wired)
- `app/clients/registry.py:20` `refresh_models` (startup only)
- `app/db/database.py:40` `Harness` (has `installed/authenticated/enabled/config/last_checked_at` but no job)
- `app/main.py:62` `health`

---

## 2. Scope

**IN:** Job manager for install/update with streaming logs, per-harness health, `last_checked_at` update, allow-list for install commands.  
**OUT:** Credential check (S6), auto-update scheduler.

---

## 3. Architecture After

```
POST /harnesses/{name}/install -> create Job{id, stage=running, logs[]} -> 202 {job_id}
GET  /harnesses/{name}/jobs/{id}       -> {stage, logs, exit_code}
GET  /harnesses/{name}/jobs/{id}/stream -> SSE progress (already have S4 envelope)
GET  /harnesses/{name}/health          -> {installed, authenticated, models, latency_ms}
GET  /health                            -> {gateway, harnesses: [{name, installed, health}]}
```

New: `app/services/harness_job_service.py`, `app/api/harness_jobs.py` (or extend `admin.py`), `app/db/database.py` new `HarnessJob` OR in-memory only (choose in-memory for simplicity, persist `Harness.last_checked_at`).

---

## 4. Detailed Tasks

### 4.1 S5.1 — Job Manager (`1h`)

- [ ] Create `app/services/harness_job_service.py`:

```python
from dataclasses import dataclass, field
import asyncio, time, uuid

@dataclass
class HarnessJob:
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    harness: str = ""
    stage: str = "pending"  # pending|running|completed|failed
    logs: list[str] = field(default_factory=list)
    exit_code: int | None = None
    created_at: float = field(default_factory=time.monotonic)

class HarnessJobService:
    def __init__(self): self._jobs: dict[str, HarnessJob] = {}; self._lock = asyncio.Lock()
    async def start_install(self, adapter: HarnessAdapter) -> HarnessJob: ...
    async def start_update(self, adapter: HarnessAdapter) -> HarnessJob: ...
    async def get(self, job_id: str) -> HarnessJob | None: ...
    def list_for_harness(self, harness: str) -> list[HarnessJob]: ...
```

- [ ] `start_install` does `async for event in adapter.install(): job.logs.append(event["message"]); job.stage = event["stage"]` (adapter already yields `stage: running` per line `app/clients/base.py:28`). Run as `asyncio.create_task`.

- [ ] Singleton `harness_job_service = HarnessJobService()`.

### 4.2 S5.2 — Wire Install Endpoint (`45m`)

- [ ] Replace `app/api/admin.py:41` stub:

```python
@router.post("/harnesses/{name}/install")
async def install_harness(name: str, _: User = Depends(admin_user)):
    try: adapter = get_adapter(name)
    except KeyError: raise HTTPException(404)
    # allow-list: only if adapter.install_command starts with npm install -g @scope/pkg
    if not adapter.install_command or adapter.install_command[0] != "npm":
        raise HTTPException(400, "No install recipe")
    job = await harness_job_service.start_install(adapter)
    return {"job_id": job.id, "status": job.stage}
```

- [ ] Add `GET /harnesses/{name}/jobs/{job_id}` → `job` JSON.
- [ ] Add `GET /harnesses/{name}/jobs/{job_id}/stream` → SSE `event: log` per `job.logs` + `event: done` when `completed/failed`. Reuse `app/shared/sse.py` `sse_event`.

### 4.3 S5.3 — Health (`45m`)

- [ ] Extend `app/api/admin.py:25` `harnesses` to include `last_checked_at` and health detail:

```python
@router.get("/harnesses/{name}/health")
async def harness_health(name: str, _: User = Depends(current_user)):
    adapter = get_adapter(name); start = time.monotonic()
    installed = adapter.is_installed()
    models = []
    if installed:
        try: models = await asyncio.wait_for(adapter.list_models(), timeout=5)
        except asyncio.TimeoutError: models = []
    latency = int((time.monotonic()-start)*1000)
    # update Harness.last_checked_at in DB
    return {"name": name, "installed": installed, "models": len(models), "latency_ms": latency}
```

- [ ] Update `app/main.py:62` `health` to aggregate:

```python
@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    harnesses = []
    for a in all_adapters():
        h = await harness_health(a.name, ...) # or lightweight
        harnesses.append(...)
    return {"status":"ok", "service":settings.app_name, "version":settings.version, "harnesses": harnesses}
```

But keep `GET /health` fast — do not call `list_models` there, just `is_installed` + cached `last_checked_at`.

### 4.4 S5.4 — Model Refresh Job (`30m`)

- [ ] Make `refresh_models` `app/clients/registry.py:20` update `Harness.last_checked_at` in DB after each `list_models`. Add `try/except` already there, but also set `installed` flag in `Harness` table.

- [ ] Keep `POST /harnesses/refresh` `app/api/admin.py:36` but make it trigger job and return `job_id` (or keep sync for small model lists — document).

---

## 5. DB Changes

- New `HarnessJob` in-memory only (no migration) OR add `harness_jobs` table if persistence desired. Simpler: in-memory + `Harness.last_checked_at` already `app/db/database.py:51` exists — just update it.

If adding `harness_jobs` table:

```python
class HarnessJobRecord(Base):
    __tablename__ = "harness_jobs"
    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    harness: Mapped[str] = mapped_column(String(80), index=True)
    stage: Mapped[str] = mapped_column(String(20))
    logs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
```

Migration via `create_all` for tests.

---

## 6. Tests

**Integration** `tests/integration/test_harness_lifecycle.py`:

- `test_install_creates_job_and_streams_logs` — mock `adapter.install` to yield 2 `running` + `completed`, `POST /install` → `job_id`, `GET /jobs/{id}` → `completed`, `GET /jobs/{id}/stream` → SSE `event: log` count 2.
- `test_install_rejects_unknown_harness_returns_404`
- `test_install_rejects_no_recipe_returns_400` — use `GenericAdapter` with empty `install_command`.

**Integration** `tests/integration/test_health.py`:

- `test_health_returns_ok_and_harnesses` — `GET /health` → `status ok`, `harnesses` list length 4.
- `test_harness_health_returns_installed_flag` — mock `is_installed` false → `installed false`.

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_harness_lifecycle.py tests/integration/test_health.py -q
```

---

## 7. Verification & Exit

- [ ] Dashboard `POST /harnesses/opencode/install` → `202 {job_id}`, `GET /jobs/{id}/stream` shows `npm install` logs streaming, final `completed`.
- [ ] `GET /api/admin/harnesses/opencode/health` returns `installed` bool + `latency_ms` <1000.
- [ ] `GET /health` still fast (<100ms) without calling `list_models` for each harness (just `is_installed`).
- [ ] `pytest -m integration -q` green; total ~110 tests.

**Checklist:**

- [ ] `- [x] S5 Harness Lifecycle & Health`

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Long `npm install` blocks event loop | `adapter.install` already `create_subprocess_exec` async per line — not blocking. |
| Job logs memory leak | Cap `job.logs` to 500 lines, LRU, cleanup jobs older than 1h. |
| Allow-list bypass | Validate `install_command` starts with `["npm","install","-g"]` and package matches `ADAPTERS` allow-list before execution. |

**Rollback:** Keep old stub behind feature flag `if not settings.enable_harness_jobs: return stub`.

