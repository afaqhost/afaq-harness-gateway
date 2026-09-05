# Phase 01 — Security Hardening & Rate Limiting

**Session ID:** `S1` · **Effort:** 3h · **Risk:** High · **Depends:** None  
**Goal:** Close the four abuse vectors that make the gateway unshippable: unenforced quotas, wildcard CORS, default secrets, docker.sock mount.

---

## 1. Why This Phase First

`AFQAUDIT.md:240` flags `APIKey.daily_limit/monthly_limit/allowed_models` as *stored never checked* — any key can call any model infinitely. `app/main.py:22` has no rate-limit middleware, `app/core/config.py:14` ships `change-me-in-production`, `app/core/config.py:20` allows `*`, `docker-compose.yml:14` mounts the host docker socket. Fixing these first unblocks all later sessions (every new endpoint must be rate-limited).

**Files you will touch (read before edit):**

- `app/main.py:22` — `app.add_middleware(CORSMiddleware, ...)`
- `app/db/database.py:33-35` — `APIKey.daily_limit/monthly_limit/allowed_models`
- `app/api/openai.py:47` `resolve_identity` — where `key_id` is resolved, quota never checked
- `app/api/chat.py:155` `send_message` — same
- `app/core/config.py:14-20` — `secret_key`, `credentials_key`, `allowed_origins`
- `app/core/security.py:21` — `generate_api_key`
- `docker-compose.yml:14`

---

## 2. Scope (IN vs OUT)

**IN:**
- Token-bucket rate limiter (in-memory for tests, Redis `RateLimiter` protocol for prod)
- Enforcement of `daily_limit` / `monthly_limit` per `APIKey`
- Enforcement of `allowed_models` per key (`403` if blocked)
- CORS tightening, secrets fail-fast, docker.sock removal, error sanitization

**OUT (deferred):**
- Key rotation (`S8`), per-user concurrency limits, Redis deployment itself (stub only)

---

## 3. Architecture After Phase

```
Client -> CORSMiddleware (tightened) -> RateLimitMiddleware -> resolve_identity -> allowed_models check -> handler
                                          |
                                          v
                                     UsageRecord count (today/month) -> 429 if exceeded
```

New layer: `app/middleware/rate_limit.py` (leaf, no import from `services/`), `app/services/quota_service.py` (business rule, depends on `APIKey` + `UsageRecord` via repository).

Dependency direction: `middleware -> quota_service -> repository` (never reverse).

---

## 4. Detailed Tasks

### 4.1 S1.1 — Rate Limiter Middleware (`1h`)

- [ ] Create `app/middleware/rate_limit.py`:

```python
from typing import Protocol
import time
from collections import defaultdict, deque

class RateLimiter(Protocol):
    def allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int]: ...

class InMemoryRateLimiter:
    def __init__(self): self._hits: dict[str, deque[float]] = defaultdict(deque)
    def allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int]:
        now = time.monotonic(); q = self._hits[key]
        while q and q[0] <= now - window_s: q.popleft()
        if len(q) >= limit: return False, int(q[0] + window_s - now)
        q.append(now); return True, 0
```

- [ ] Create `app/middleware/__init__.py` (empty).
- [ ] Add `RateLimitMiddleware(BaseHTTPMiddleware)` that:
  1. extracts `key_id` or `user_id` or `client_ip` as `bucket_key`,
  2. calls `limiter.allow(bucket_key, limit=60, window_s=60)` for global (configurable via `settings.rate_limit_per_minute` new field),
  3. on `False` returns `429 {"error":{"code":"rate_limited","message":"...","retry_after":int}}` with `Retry-After` header.
- [ ] Add `settings.rate_limit_per_minute: int = 60` `app/core/config.py:17` + `rate_limit_enabled: bool = True`.
- [ ] Wire in `app/main.py:23` **before** `CORSMiddleware`:

```python
from app.middleware.rate_limit import RateLimitMiddleware, InMemoryRateLimiter
app.add_middleware(RateLimitMiddleware, limiter=InMemoryRateLimiter())
```

- [ ] Make `RateLimiter` injectable for tests: `app.dependency_overrides[RateLimiter]`.

### 4.2 S1.2 — Enforce `daily_limit` / `monthly_limit` (`45m`)

- [ ] Create `app/services/quota_service.py`:

```python
def is_quota_exceeded(db: AsyncSession, api_key: APIKey, now: datetime) -> tuple[bool, str]:
    # count UsageRecord where api_key_id == api_key.id and created_at >= today
    # if daily_limit and count >= daily_limit -> (True, "daily")
    # similarly monthly (first day of month)
```

- [ ] Call it inside `app/api/openai.py:90` `chat_completions` after `resolve_identity` and `app/api/chat.py:155` `send_message` / `233` `stream_message` (pass `key_id` through). If exceeded, raise `HTTPException(429, detail={"code":"quota_exceeded",...})`.
- [ ] For JWT users without `api_key_id`, skip quota (or add per-user quota later — document as future).

### 4.3 S1.3 — Enforce `allowed_models` (`45m`)

- [ ] Add in `app/services/model_service.py:45` new helper:

```python
def is_model_allowed(requested: str, allowed: list[str] | None) -> bool:
    if not allowed: return True
    return requested in allowed or any(requested.startswith(a) for a in allowed)  # support prefix wildcards if needed
```

- [ ] Thread `allowed_models` through: `resolve_identity` returns `api_key.allowed_models`, `select_model_for_conversation` gets new param `allowed_models`, calls `validate_model_or_400` then checks `is_model_allowed`, raises `HTTPException(403, {"code":"model_forbidden"})` if blocked.
- [ ] Update call sites: `app/api/chat.py:164` `select_model_for_conversation(payload.model, conv.model, allowed_models=...)`.

### 4.4 S1.4 — Secrets & CORS (`30m`)

- [ ] `app/core/config.py:14` change defaults to `""` and in `get_settings()` `app/core/config.py:42` add:

```python
if not settings.debug and (settings.secret_key == "change-me-in-production" or not settings.secret_key):
    raise RuntimeError("SECRET_KEY must be set in production")
```

- [ ] `app/core/config.py:20` default `allowed_origins` → `"http://127.0.0.1:3500,http://localhost:3500"`; update `docs/configuration.md` table.
- [ ] `docker-compose.yml:14` delete `- /var/run/docker.sock:/var/run/docker.sock` line, keep only `data`/`storage` volumes; add comment:

```yaml
# DO NOT mount docker.sock in production — use Docker TCP+TLS or build-only image
```

### 4.5 S1.5 — Error Sanitization (`30m`)

- [ ] In `app/api/chat.py:192` and `app/api/openai.py:161`, replace `raise HTTPException(502, str(exc))` where `exc` contains `stderr` paths with sanitized mapping:

```python
sanitized = "Harness failed — check model availability" if "ollama" in str(exc).lower() else "Harness error"
raise HTTPException(502, detail={"code":"harness_error","message":sanitized})
```

But keep original `str(exc)` in server logs (`logger.error`).

---

## 5. DB / Config Changes

- No schema migration. `APIKey` already has columns. Only new `Settings` fields `rate_limit_per_minute`, `rate_limit_enabled`.
- For `monthly` quota, need index on `usage_records.created_at` already `app/db/database.py:86` `index=True` — ok.

---

## 6. Tests to Add (TDD)

Create `tests/unit/test_rate_limiter.py`:

- `test_allow_within_limit_returns_true`
- `test_allow_exceeds_limit_returns_false_and_retry_after`
- `test_window_slides_after_expiry` (parametrize `limit=2, window=1s`)

Create `tests/integration/test_rate_limit_integration.py` (real DB `tests/conftest.py:16`):

```python
async def test_daily_limit_blocks_sixth_request(client, db_session, user_headers):
    # create key with daily_limit=5
    # loop 5 POST /v1/chat/completions with FakeAdapter -> 200
    # 6th -> 429 + Retry-After
```

Create `tests/integration/test_allowed_models.py`:

- `test_allowed_models_allows_listed`
- `test_allowed_models_blocks_unlisted_returns_403`

Extend `tests/security/test_security.py` with `test_rate_limited_returns_429_not_500`.

**Run after each sub-task:**

```bash
.venv/bin/python -m pytest tests/unit/test_rate_limiter.py -q
.venv/bin/python -m pytest tests/integration/test_rate_limit_integration.py -q
```

---

## 7. Verification & Exit Criteria

- [ ] `curl -H "Authorization: Bearer $KEY" /v1/chat/completions` 6 times with `daily_limit=5` → 6th is `429` with `Retry-After`.
- [ ] Key with `allowed_models=["opencode//opencode/big-pickle"]` calling `commandcode//deepseek` → `403 {"code":"model_forbidden"}`.
- [ ] `docker compose config | grep docker.sock` → no output.
- [ ] `SECRET_KEY=change-me-in-production DEBUG=false uvicorn app.main:app` → fails fast on startup.
- [ ] `pytest -m security -q` + `pytest -m integration -q` green; new tests ~12, total ~108.

**Checklist to mark S1 done in `docs/IMPLEMENTATION_PLAN.md:118`:**

- [ ] `- [x] S1 Security & Rate Limit`

---

## 8. Risks & Rollback

| Risk | Mitigation |
|---|---|
| In-memory limiter not shared across workers | Document: single-process only; prod must swap `InMemoryRateLimiter` for `RedisRateLimiter` via `app/config/settings.py` `redis_url` (S8). |
| Quota count query slow | `usage_records` already indexed on `api_key_id` `app/db/database.py:76` and `created_at` `app/db/database.py:86`; add composite index if `EXPLAIN QUERY PLAN` shows scan. |
| Breaking existing keys with `allowed_models=None` | `is_model_allowed` returns `True` when `None` — backward compatible. |

**Rollback:** Revert `app/main.py:23` middleware line and `S1.2`/`S1.3` checks — no schema change, safe.

