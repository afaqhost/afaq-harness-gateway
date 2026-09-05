# Phase 01 — استخراج `transport/SSE` وتخفيف `controllers`

> **الهدف:** `app/api/chat.py:1` من `606` سطر → `~150` سطر، `app/api/openai.py:1` من `476` → `~180`، توحيد منطق `SSE` المكرر، رفع تزامن المطورين من `3-5` إلى `6`.
> **بدون `Postgres`:** نعم، pure refactor في `Python`.

## 1.1 الدخول

* `204` اختبار أخضر `pytest -q` (بعد `harvest_env_credentials` + `sanitize_harness_error`).
* `app/api/chat.py:393` `stream_message` و `app/api/openai.py:198` `_stream_response` يحتويان نفس الحلقة:
  ```python
  pending = asyncio.create_task(stream_iter.__anext__())
  done,_ = await asyncio.wait([pending], timeout=sse_heartbeat_seconds) # 15s app/core/config.py:24
  if not done: yield ": keepalive\n\n"
  # + history append + metrics + UsageRecord
  ```

## 1.2 المهام

- [ ] **01.1 إنشاء `app/transport/sse.py`**
  - `sse_event()` موجود `app/shared/sse.py:8` — انقله أو أبقه `shared`، وأضف في `transport`:
    ```python
    async def stream_with_heartbeat(adapter, prompt, model, request_id, env, heartbeat_s=15):
        # يغلف adapter.stream() + heartbeat + cancel check + history
    ```
  - `HistoryStore` protocol: `append(key, seq, payload)` + `replay(key, last_id)` — حالياً `ProcessRegistry` `app/services/process_registry.py:95` يملكها بالخطأ (يجب أن تكون `transport`).

- [ ] **01.2 استخراج `app/transport/history.py`**
  - انقل `ProcessRegistry._history` `file:32` `deque(maxlen=100)` إلى `app/transport/history.py:InMemoryHistory` مع نفس `append_history`/`get_replay`/`get_history`. `ProcessRegistry` يبقى مسؤولاً فقط عن `process`.

- [ ] **01.3 تخفيف `app/api/chat.py`**
  - `stream_message` `file:348` يصبح:
    ```python
    @router.post("/conversations/{conv_id}/messages/stream")
    async def stream_message(..., db=Depends(get_db)):
        conv = await repo_get_conversation_or_404(...)
        model = select_model_for_conversation(...) # app/services/model_service.py:113
        history = await build_history(conv.id, db)
        prompt = build_harness_prompt(...) # app/shared/prompt_utils.py:11
        env = await credential_service.get_env_for_harness(db, user.id, harness) # file:66
        return StreamingResponse(
            transport.stream_with_heartbeat(adapter, prompt, model_name, request_id, env),
            media_type="text/event-stream", headers={...}
        )
    ```
  - احذف `logger.error` المكرر، استخدم `sanitize_harness_error` `app/shared/errors.py:8` مرة واحدة في `transport`.

- [ ] **01.4 توحيد `app/api/openai.py`**
  - نفس `stream_with_heartbeat` مع `history_key = f"openai:{user_id}"` `file:205`.
  - `_non_stream_response` `file:373` يستخرج `validate_json_response` `app/shared/structured_output.py:9` إلى `transport`.

- [ ] **01.5 اختبارات**
  - `tests/unit/test_transport_sse.py` — heartbeat كل `15s` (mock adapter بطيء).
  - تحديث `tests/integration/test_sse_reconnect.py` و `tests/contract/test_sse_contract.py` ليتوقع `event: token/id/retry` من `transport`.

## 1.3 الخروج

* `app/api/chat.py` <200 سطر، `app/api/openai.py` <220 سطر، `app/transport/` مجلد جديد يظهر في `ls app`.
* `pytest -q` 204+ جديد، `compileall -q app` 0.
* `clean-code-guard: F1 ≤20 lines, F5 ≤4 params` تمر لمعظم الدوال الجديدة.

## 1.4 المخاطر

* `Last-Event-ID` `app/api/chat.py:416` حالياً `int` — حافظ على التوافق.
* `process_registry` و `history` كانا في نفس القفل `asyncio.Lock` — افصلهما لتجنب `deadlock`.

**الجهد:** 3 ساعات (1h transport + 1h chat + 1h openai + tests).
