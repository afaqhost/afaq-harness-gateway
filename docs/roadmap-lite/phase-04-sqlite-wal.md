# Phase 04 — تحسين `SQLite` (`WAL` + `pool` + قياس `RAM`)

> **الهدف:** `SQLite` الحالي `app/db/database.py:8` يبقى، لكن يتحمل `300-500` قراءة متزامنة بدون `database is locked`.
> **الجهد:** 1 ساعة — تغيير سطرين + توثيق.

## 4.1 الدخول

* Phases 01-03 منتهية — `transport` + `Redis` + `Queue` جاهزة.
* `app/db/database.py:8`:
  ```python
  engine = create_async_engine(settings.database_url, connect_args={"check_same_thread": False})
  ```
  بدون `WAL`، كاتب واحد يقفل القراءات.

## 4.2 المهام

- [ ] **04.1 `WAL` + `pool`**
  - في `app/db/database.py:10` بعد `create_async_engine`، أضف `event.listen`:
    ```python
    from sqlalchemy import event
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA cache_size=-64000;") # 64 MB cache
        cursor.execute("PRAGMA busy_timeout=5000;") # 5s بدلاً من locked فوراً
        cursor.close()
    ```
  - أضف `pool_size=20, max_overflow=10` إذا `settings.database_url` يحتوي `sqlite` (لـ `aiosqlite` استخدم `NullPool` مع `WAL` يكفي).

- [ ] **04.2 `docker-compose.yml`**
  - لا تلمس `volumes: afaq_data:/app/data` — يبقى `SQLite` ملف.
  - أضف `healthcheck` لـ `redis` فقط، لا لـ `db`.

- [ ] **04.3 توثيق `docs/configuration.md`**
  - أضف قسم `SQLite WAL`:
    ```
    DATABASE_URL=sqlite+aiosqlite:///./data/afaq.db  # WAL يسمح بقراءات متوازية، كاتب واحد
    # للانتقال إلى Postgres لاحقاً: DATABASE_URL=postgresql+asyncpg://user:pass@db:5432/afaq
    ```
  - اذكر أن `Base.metadata.create_all` `app/db/database.py:92` يبقى، لا حاجة `Alembic` حتى `Postgres`.

- [ ] **04.4 قياس `RAM` بعد كل Phases**
  - أعد قياس `VmRSS` كما في `phase-02`:
    ```bash
    .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 3500 &
    sleep 3; ps -o pid,rss,vsz,cmd -p $!
    free -h
    ```
  - المتوقع بدون `Postgres`:
    * خمول: `130` → `160 MB` (+30 `redis`)
    * `512 MB` → `20` `chat` متزامن (5 تعمل + 15 queue) بدلاً من `5`
    * `4GB` → `50` متزامن

- [ ] **04.5 اختبارات**
  - `tests/integration/test_concurrent_writes.py` (جديد) — 10 `POST /conversations` متزامنة → لا `database is locked` بعد `WAL`.
  - `pytest -q` يبقى `204+`.

## 4.3 الخروج

* `data/afaq.db` يعمل `WAL` (`ls data/*.db-wal` موجود).
* `docs/roadmap-lite/README.md` كل Phases `[x]`.
* جاهز لـ `Postgres` لاحقاً بدون تغيير `repositories` `app/repositories/conversation_repository.py:17`.

## 4.4 المخاطر

* `WAL` لا يحل كاتب واحد — لو ظهر `database is locked` متكرر في `logs`، هذا إشارة للانتقال إلى `Postgres` (ليس فشل الخطة).
* `cache_size=-64000` يستهلك `64 MB` إضافية — مقبول مقابل سرعة القراءة.

**الجهد:** 1 ساعة.
