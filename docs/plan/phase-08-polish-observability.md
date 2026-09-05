# Phase 08 — Polish: Key Rotation, Error Standardization, Observability

**Session ID:** `S8` · **Effort:** 3h · **Risk:** Low · **Depends:** S1–S7  
**Goal:** Production-grade ops: rotation, unified errors, request IDs, metrics.

---

## 1. Why

`AFQAUDIT.md:170` flags `key rotation` *Missing*, `AFQAUDIT.md:198` `standardized error format` inconsistency (`{"detail":...}` vs `{"error":...}`), `AFQAUDIT.md:225` `observability` *No structured logs, no request IDs, no metrics*. These are low-risk but required for on-call.

**Files:**

- `app/api/admin.py:58` `create_key` (no rotate)
- `app/main.py:22` middleware stack
- `app/api/auth.py:27` error messages
- No `app/middleware/` before S1 (now has `rate_limit`)

---

## 2. Scope

**IN:** `POST /keys/{id}/rotate`, unified `ErrorCode`, `X-Request-ID`, JSON logs, `GET /metrics`.  
**OUT:** Distributed tracing (OpenTelemetry), audit log table (future).

---

## 3. Architecture After

```
Request -> RequestIdMiddleware (X-Request-ID) -> LoggingMiddleware (JSON) -> RateLimit -> handler
                                          |
                                          v
                                     Prometheus /metrics
```

New: `app/middleware/request_id.py`, `app/middleware/logging.py`, `app/shared/errors.py`, `app/api/metrics.py`.

---

## 4. Detailed Tasks

### 4.1 S8.1 — Key Rotation (`45m`)

- [ ] Add `POST /api/admin/keys/{key_id}/rotate` `app/api/admin.py:69`:

```python
@router.post("/keys/{key_id}/rotate")
async def rotate_key(key_id: int, user=Depends(current_user), db=Depends(get_db)):
    key = await db.get(APIKey, key_id)
    if not key or key.user_id != user.id: raise HTTPException(404)
    old_prefix = key.key_prefix
    raw, prefix, digest = generate_api_key()
    key.key_prefix = prefix; key.key_hash = digest; key.last_used_at = None
    # keep old digest in grace table for 5m? Simpler: just rotate, old key 401 immediately
    await db.commit()
    return {"id": key.id, "key": raw, "prefix": prefix, "warning":"Old key revoked. Store new one."}
```

- [ ] Grace: optional `api_key_grace` table `{old_hash, new_key_id, expires_at}` for 5m — if lookup fails, check grace, allow, log warning. Skip for S8 v1, document.

### 4.2 S8.2 — Unified Errors (`45m`)

- [ ] Create `app/shared/errors.py`:

```python
from enum import StrEnum

class ErrorCode(StrEnum):
    validation_error = "validation_error"
    auth_error = "auth_error"
    harness_error = "harness_error"
    rate_limited = "rate_limited"
    model_forbidden = "model_forbidden"
    quota_exceeded = "quota_exceeded"
    not_found = "not_found"
    malformed_output = "malformed_output"

def error_payload(code: ErrorCode, message: str, retryable: bool = False) -> dict:
    return {"error": {"code": code, "message": message, "type": code, "retryable": retryable}}
```

- [ ] Add exception handler in `app/main.py:22`:

```python
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    if isinstance(exc.detail, dict) and "code" in exc.detail.get("error",{}):
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    # wrap plain detail
    return JSONResponse(status_code=exc.status_code, content=error_payload(ErrorCode.validation_error, str(exc.detail)))
```

- [ ] Update all `raise HTTPException(400, "msg")` to `raise HTTPException(400, detail=error_payload(ErrorCode.validation_error, "msg"))`. Cover `app/api/chat.py:159`, `app/services/model_service.py:50`, `app/api/admin.py:49`.

- [ ] Update `docs/api.md` error table.

### 4.3 S8.3 — Request IDs & Logging (`45m`)

- [ ] Create `app/middleware/request_id.py`:

```python
import uuid
from starlette.middleware.base import BaseHTTPMiddleware

class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = request.headers.get("X-Request-ID", uuid.uuid4().hex[:12])
        request.state.request_id = rid
        resp = await call_next(request)
        resp.headers["X-Request-ID"] = rid
        return resp
```

- [ ] Create `app/middleware/logging.py`:

```python
import logging, json, time

class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start = time.monotonic()
        resp = await call_next(request)
        log = {"request_id": getattr(request.state, "request_id", "-"), "method": request.method, "path": request.url.path, "status": resp.status_code, "duration_ms": int((time.monotonic()-start)*1000)}
        # redact Authorization
        logging.getLogger("afaq").info(json.dumps(log))
        return resp
```

- [ ] Wire in `app/main.py:22` **first** (outermost):

```python
app.add_middleware(RequestIdMiddleware)
app.add_middleware(LoggingMiddleware)
app.add_middleware(RateLimitMiddleware, ...)
app.add_middleware(CORSMiddleware, ...)
```

### 4.4 S8.4 — Metrics (`45m`)

- [ ] Create `app/api/metrics.py`:

```python
from fastapi import APIRouter
router = APIRouter()
@router.get("/metrics")
async def metrics():
    # if prometheus_client not installed, return 501
    try: from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    except: raise HTTPException(501, "metrics not installed")
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
```

- [ ] Add counters in `app/api/chat.py:188` `result_h = await adapter.run` → `metrics.harness_calls.labels(harness=harness_name, model=model).inc()` and `histogram.observe(latency)`.

- [ ] Add to `requirements.txt` `prometheus-client==0.21.1` optional.

### 4.5 S8.5 — Config & Docs (`30m`)

- [ ] Update `docs/configuration.md` with `rate_limit_*`, `metrics`, `request_id` headers.
- [ ] Update `docs/api.md` error codes table.

---

## 5. Tests

**Integration** `tests/integration/test_key_rotation.py`:

- `test_rotate_returns_new_key_and_old_fails` — create key, `POST /rotate` → new raw, old `Bearer old` → `401` on `/v1/chat/completions`.

**Contract** `tests/contract/test_error_schema.py`:

```python
@pytest.mark.parametrize("path", ["/api/chat/conversations/9999", "/v1/chat/completions"])
async def test_error_shape_has_code(client, user_headers, path):
    resp = await client.get(path, headers=user_headers) if "conversations" in path else await client.post(path, headers=user_headers, json={"model":"x","messages":[]})
    assert "error" in resp.json()
    assert "code" in resp.json()["error"]
```

**Integration** `tests/security/test_request_id.py`:

- `test_request_id_echoed` — `GET /health` with `X-Request-ID: test123` → response header `X-Request-ID: test123`, logs contain it (`caplog`).

**Integration** `tests/integration/test_metrics.py`:

- `GET /metrics` → `200` and contains `harness_calls`.

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_key_rotation.py tests/contract/test_error_schema.py -q
```

---

## 6. Verification & Exit

- [ ] `POST /keys/1/rotate` → new key, old key `401`.
- [ ] `curl -H "X-Request-ID: abc" /health` → `X-Request-ID: abc` echoed, log `{"request_id":"abc",...}`.
- [ ] `GET /metrics` → `200` Prometheus text.
- [ ] All errors `{"error":{"code":...}}` (no `{"detail":"msg"}`).
- [ ] `pytest -m contract -q` + `pytest -m integration -q` green; total ~120 tests.

**Checklist:**

- [ ] `- [x] S8 Polish`

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| `prometheus_client` not installed breaks `/metrics` | Guard `ImportError` → `501`, document optional. |
| `X-Request-ID` collision | `uuid4` 12 hex ~ 47 bits, low collision for logs. |
| Unified error breaks existing clients expecting `detail` string | Keep backward compat: if client sends `Accept: application/vnd.afaq.v1` old, return `detail`; else new `error.code`. Or version `Accept` header. Simpler: always new shape, update `app/static/app.js` to handle both. |

**Rollback:** Remove middlewares from `app/main.py:22`, revert error payload to `detail` string — no schema change.

---

## 8. Done Definition (All Phases)

- All 8 checkboxes in `docs/IMPLEMENTATION_PLAN.md:118` checked.
- `96 + ~30` new tests → `~126` total `pytest -q` green.
- `docs/api.md` and `docs/configuration.md` updated.
- `docker-compose.yml` no `docker.sock`, `SECRET_KEY` required.
- Manual smoke: `cp .env.example .env && docker compose up --build` → `http://127.0.0.1:3500/login` bootstrap, create key, `curl /v1/chat/completions` stream with `Last-Event-ID` reconnect works, `POST /cancel` kills.

