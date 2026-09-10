# Phase 05 — Testing & Integration (OpenAI-Compatible)

> **Goal:** New harnesses pass same contract as existing 4: non-stream, stream, tool calls, SSE, quota.
> **Entry:** Adapters + model discovery done.
> **Exit:** `pytest -q` still 204+ (new tests added), `POST /v1/chat/completions` works for `agy`, `pi`, `minimax` (mocked), `GET /v1/models` shape correct.

## Tasks

- [ ] **P05.1 Unit tests `tests/unit/test_harness_adapters.py`** — Add parametrized tests per new adapter:
  ```python
  @pytest.mark.parametrize("adapter_name,model", [("agy","agy//test"),("pi","pi//default"),("minimax","minimax//m2")])
  def test_build_command_contains_prompt(adapter_name):
      adapter = get_adapter(adapter_name)
      cmd = adapter.build_command("hi", model="test")
      assert "hi" in cmd
  ```

- [ ] **P05.2 Model validation `tests/unit/test_model_allowed.py`** — Ensure `is_model_allowed` `app/services/model_service.py:66` allows `agy/*`, `pi/*`, `minimax/*` wildcards.

- [ ] **P05.3 Integration `tests/integration/test_chat_integration.py:105`** — Add mocked test for each new harness:
  ```python
  async def test_openai_chat_with_agy_mock(client, api_key_headers):
      with patch("app.api.openai.get_adapter") as m:
          m.return_value.run = fake_run
          resp = await client.post("/v1/chat/completions", headers=headers, json={"model":"agy//test","messages":[{"role":"user","content":"hi"}]})
          assert resp.status_code==200 and resp.json()["choices"][0]["message"]["content"]=="..."
  ```

- [ ] **P05.4 SSE contract `tests/contract/test_sse_contract.py:72`** — Copy `test_openai_sse_emits_event_and_id` for `agy`/`pi` to ensure `event: token`, `id:`, `retry:3000`, `event: done` `[DONE]` still hold.

- [ ] **P05.5 Tool contract `tests/contract/test_tool_contract.py`** — For harnesses with custom `parse_line`, mock `tool_call` JSON and assert `choices[0].message.tool_calls` in non-stream and `event: tool_call` in stream `openai.py:273`.

- [ ] **P05.6 Error cases** — Unknown model `agy//nonexistent` → `400` `model_service.py:56`, not-installed harness → `[]` not `500`, timeout → `504` `base.py:118`.

## Verification

```bash
python -m compileall -q app
.venv/bin/python -m pytest -q
.venv/bin/python -m pytest -q -k "test_harness_adapters"
.venv/bin/python -m pytest -q -k "test_chat_integration"
curl -H "Authorization: Bearer afaq_..." -d '{"model":"agy//test","messages":[{"role":"user","content":"hi"}]}' http://127.0.0.1:3500/v1/chat/completions | jq
# with mocked adapter (no real CLI) still 200
```

## Deliverables

- New tests in `tests/unit/test_harness_adapters.py`, `tests/integration/test_chat_integration.py`.
- All new harnesses reachable via `POST /v1/chat/completions` (mocked) and `GET /v1/models`.

## Next

→ `phase-06-docs-dashboard.md`
