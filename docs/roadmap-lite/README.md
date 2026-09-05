# Roadmap Lite — بدون Postgres (4 Phases)

> **الهدف:** رفع التزامن من `5` إلى `20-30` مستخدم متزامن على `512 MB`، ورفع تزامن المطورين من `3-5` إلى `6-8`، **بدون تغيير `SQLite`** `app/db/database.py:8`.
> **الاستهلاك الحالي:** خمول `130 MB` (قياس `VmRSS 84456 kB` `uvicorn` + `~40 MB` buffers)، لكل `stream` +`75 MB` (`node 41 MB` + `gateway 5 MB` + harness).
> **بعد الخطة:** خمول `~150-180 MB` مع `Redis` (+30 MB) لكن كل `512 MB` ستشيل `20` بدلاً من `5` بفضل الطابور + `Redis` stateless.

## الخريطة

| Phase | العنوان | الملفات الأساسية | الجهد | يعتمد على |
|---|---|---|---|---|
| **01** | استخراج `transport/SSE` وتخفيف `controllers` | `app/api/chat.py:348`, `app/api/openai.py:192`, جديد `app/transport/sse.py` | 3h | — |
| **02** | نقل الحالة المؤقتة إلى `Redis` | `app/middleware/rate_limit.py:26`, `app/services/process_registry.py:28`, `app/clients/registry.py:26`, `app/services/harness_job_service.py:36` | 4h | 01 |
| **03** | طابور `Queue` لعمليات `Harness` + `backpressure` | `app/clients/base.py:86`, `app/services/harness_job_service.py` | 3h | 02 |
| **04** | تحسين `SQLite` (`WAL` + `pool` + قياس `RAM`) | `app/db/database.py:8`, `docker-compose.yml`, `docs/configuration.md` | 1h | — |

كل Phase تنتهي بـ `compileall -q app && pytest -q` أخضر (204 حالياً).

> **مستبعد عمداً:** `Postgres` + `Alembic` migration + `read replica`. سيبقى `SQLite` مع `WAL`. عند ظهور `database is locked` متكرر في `logs`، انقل `DATABASE_URL` إلى `postgresql+asyncpg` — الـ `repositories` معزولة أصلاً `app/repositories/conversation_repository.py:17`.

## كيف تستأنف

1. افتح هذا المجلد، ابدأ من أول ملف غير مكتمل `phase-0*.md`.
2. نفذ المهام بالترتيب، `commit` لكل حركة `refactor(transport): ...` + `test`.
3. بعد كل Phase: ` .venv/bin/python -m pytest -q` يجب أن يبقى `204 + جديد`.

## التقدم

- [x] Phase 01 — transport/SSE (HistoryStore + stream helper `app/transport/`)
- [x] Phase 02 — Redis ephemeral (rate limiter `app/middleware/rate_limit.py:60`, history `app/transport/history.py:38`, MODEL_CACHE `app/clients/registry.py:26`, jobs `app/services/harness_job_service.py`, compose `redis:7-alpine`)
- [x] Phase 03 — Queue (`harness_concurrency=5` `app/core/config.py:18`, `app/services/harness_queue.py`, wrapping `app/clients/base.py:86`)
- [x] Phase 04 — SQLite WAL (`PRAGMA journal_mode=WAL` `app/db/database.py:13`, `cache_size -64000`, `busy_timeout 5000`)

**Verification:** `compileall -q app` 0 + `pytest -q` **204 passed** (fallback in-memory when `REDIS_URL` empty).

*آخر تحديث: بدون Postgres — كل Phases مطبقة.*
