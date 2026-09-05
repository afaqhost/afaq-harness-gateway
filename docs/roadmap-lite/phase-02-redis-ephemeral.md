# Phase 02 — نقل الحالة المؤقتة إلى `Redis` (بدون `Postgres`)

> **الهدف:** `app` يصبح `stateless` — يمكن تشغيل 3 نسخ على `512 MB` كل واحدة، `cancel` `app/api/chat.py:564` يعمل `cross-pod`.
> **الاستهلاك:** `+30 MB` لـ `redis:7-alpine`، لكن `RAM/مستخدم` ينخفض لأن `history` و `rate_limit` لم تعد في `process` الواحد.

## 2.1 الدخول

* Phase 01 منتهٍ — `transport` معزول.
* `app/middleware/rate_limit.py:26` `InMemoryRateLimiter._hits: dict[deque]` + `app/services/process_registry.py:28` `_map dict` + `app/clients/registry.py:26` `MODEL_CACHE` + `app/services/harness_job_service.py:36` `_jobs dict` كلها `in-memory` — تمنع التوسع الأفقي.

## 2.2 المهام

- [ ] **02.1 `RateLimiter` Redis**
  - `app/middleware/rate_limit.py:21` `RateLimiter` Protocol موجود — أضف `RedisRateLimiter` (يستخدم `INCR` + `EXPIRE 60s` أو `Lua` للـ sliding window). fallback إلى `InMemoryRateLimiter` إذا `REDIS_URL` غير مضبوط (لـ tests).
  - `app/core/config.py` أضف `redis_url: str = "redis://localhost:6379/0"` + `rate_limit_redis: bool = False` (افتراضي `False` لتبقى الاختبارات `in-memory`).
  - wiring في `app/main.py:72` `RateLimitMiddleware(limiter=...)` عبر `get_settings().redis_url`.

- [ ] **02.2 `ProcessRegistry` → `Redis`**
  - أبقِ `ProcessRegistry` للـ `process` المحلي (لا يمكن قتل `PID` من pod آخر)، لكن انقل `history` إلى `Redis`:
    - `app/transport/history.py:RedisHistory` يستخدم `LPUSH` + `LTRIM 100` + `LRANGE` بدل `deque`.
    - `Last-Event-ID` `app/api/chat.py:416` يصبح `GET replay` من `Redis` → يعمل حتى بعد `restart`.
  - `cancel_by_prefix` `app/services/process_registry.py:102` يبقى محلياً + ينشر `PUBLISH cancel:{request_id}` لتصل لكل pod (اختياري Phase 02، يمكن تأجيل pub/sub).

- [ ] **02.3 `MODEL_CACHE` → `Redis`**
  - `app/clients/registry.py:26` `MODEL_CACHE: dict` → `Redis` `SET models:{harness}` مع `TTL 300s` `model_refresh_seconds` `app/core/config.py:21`. `cached_models()` `file:63` يقرأ من `Redis` أولاً ثم fallback `dict`.
  - `refresh_models()` `file:29` يبقى `asyncio` لكن يكتب في `Redis`.

- [ ] **02.4 `HarnessJobService` → `Redis`**
  - `app/services/harness_job_service.py:36` `_jobs dict` → `Redis HASH jobs:{id}` + `LIST logs`. `stream_harness_job` `app/api/admin.py:117` يقرأ من `Redis`.

- [ ] **02.5 `docker-compose.yml`**
  - أضف `redis: image: redis:7-alpine, ports: 6379:6379, volumes: redis_data:/data, restart: unless-stopped, mem_limit: 64m`.
  - لا تلمس `app/db/database.py:8` — يبقى `SQLite`.

- [ ] **02.6 اختبارات**
  - `tests/integration/test_rate_limit_integration.py` يعمل مع `InMemory` افتراضياً — أضف `pytest.mark.redis` optional.
  - `tests/unit/test_process_registry.py` يبقى `in-memory`، `tests/integration/test_sse_reconnect.py` يختبر `RedisHistory` إذا متاح وإلا `InMemory`.

## 2.3 الخروج

* `docker compose up` يشغل `redis` + `afaq-gateway` 2 replicas (`docker compose up --scale afaq-gateway=2`) و `cancel` يعمل.
* `free -h` يظهر `+30 MB` فقط، `pytest -q` أخضر (fallback).

## 2.4 المخاطر

* `Redis` غير متاح في CI → استخدم `fakeredis` أو fallback `InMemory` (موجود).
* `process.kill()` لا يعمل عبر `Redis` — `cancel` يبقى best-effort محلي + `pub/sub` لاحقاً.

**الجهد:** 4 ساعات (1h rate limiter + 1h history + 1h model cache + 1h compose/tests).
