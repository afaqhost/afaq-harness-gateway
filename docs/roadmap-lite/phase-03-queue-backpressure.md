# Phase 03 — طابور `Queue` لعمليات `Harness` + `backpressure`

> **الهدف:** من `5` متزامن في `512 MB` إلى `20` — بدلاً من فتح `node 41 MB` لكل طلب فوراً، ضع الطلبات في طابور وحدد `concurrency=5`.
> **بدون `Postgres`:** نعم، الطابور في `Redis`، قاعدة البيانات تبقى `SQLite`.

## 3.1 الدخول

* Phase 02 منتهٍ — `Redis` متاح.
* `app/clients/base.py:86` `create_subprocess_exec` يفتح `process` مباشرةً: `run()` `file:80` + `stream()` `file:146` — مع 10 طلبات متزامنة = 10*75 MB = 750 MB → `OOM` على `512 MB`.

## 3.2 المهام

- [ ] **03.1 `app/services/harness_queue.py`**
  - `HarnessQueue` مع `max_concurrent: int = 5` (من `settings.harness_concurrency` جديد `app/core/config.py:17` بجانب `harness_timeout_seconds`).
  - يستخدم `asyncio.Semaphore(5)` محلياً + `Redis LIST queue:{harness}` للـ `distributed` (اختياري). أبسط: `Semaphore` محلي يكفي لسيرفر واحد، ومع `Redis` + `BLPOP` لتوزيع على replicas.
  - واجهة:
    ```python
    async def submit(adapter, prompt, model, request_id, env) -> HarnessResult
    async def stream_submit(...) -> AsyncIterator
    ```

- [ ] **03.2 تغليف `HarnessAdapter`**
  - `app/clients/base.py:80` `run()` و `file:146` `stream()` لا تغير التوقيع — داخلياً تستدعي `harness_queue.submit(...)` بدل `create_subprocess_exec` مباشرةً. عند الامتلاء، ينتظر `wait_for` مع `retry_after` `429` أو `202 Accepted` مع `job_id`.

- [ ] **03.3 `backpressure` في `API`**
  - `app/api/chat.py:288` `send_message` و `app/api/openai.py:373` `_non_stream_response` إذا الطابور ممتلئ (>20 انتظار)، ارجع `429 {code: rate_limited, retry_after: 5}` بدلاً من فتح `process`.
  - `X-Accel-Buffering: no` موجود `app/api/chat.py:327` — أبقه.

- [ ] **03.4 ربط `HarnessJobService`**
  - `app/services/harness_job_service.py:42` `_run_adapter` يستخدم نفس `Semaphore` — `install`/`update` لا تستهلك كل `node` أثناء `chat`.

- [ ] **03.5 اختبارات**
  - `tests/performance/test_load.py` `test_burst_conversation_creation` — مع `max_concurrent=2` (في `conftest` override)، أرسل 10 طلبات متزامنة، تأكد أن `5` فقط تعمل و `5` تنتظر أو `429`.
  - `tests/integration/test_cancel_integration.py` — `cancel` أثناء الانتظار في الطابور يزيل من `queue`.

## 3.3 الخروج

* `512 MB` يشيل `20` طلب `chat` متزامن (5 تعمل + 15 في الطابور `Redis` باستهلاك كيلوبايتات) بدلاً من `5` تعمل وتقتل السيرفر.
* `pytest -q` أخضر، `pytest -m performance -q` يظهر `p95 < 2s` مع الطابور.

## 3.4 المخاطر

* `Semaphore` محلي لا يوزع على replicas — مع `Redis` استخدم `redlock` أو `BLPOP` (يمكن تأجيل لـ Phase 03b).
* `harness_timeout 90s` `app/clients/base.py:109` يبقى — الطابور لا يزيد الـ latency للطلب الواحد.

**الجهد:** 3 ساعات (1h queue + 1h adapter wrap + 1h API/backpressure + tests).
