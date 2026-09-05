# Phase 07 — Tool Calling & Structured Output (Foundation)

**Session ID:** `S7` · **Effort:** 4h · **Risk:** High · **Depends:** S4  
**Goal:** Accept `tools` and `response_format` (OpenAI-compatible) without yet executing tools; stream `tool_call` events.

---

## 1. Why

`AFQAUDIT.md:114` `tool definitions` … `122` `streamed tool events` all *Missing* — no agentic workflows possible. `app/api/openai.py:27` `ChatRequest` has `tools` nowhere, `app/clients/codex.py:166` `parse_line` never emits `tool_call`. Must add foundation without full execution engine (deferred).

**Files:**

- `app/api/openai.py:27` `ChatRequest` (no `tools`)
- `app/clients/base.py:52` `parse_line` (returns `line, {}`)
- `app/clients/codex.py:166`, `app/clients/opencode.py:193`, `app/clients/commandcode.py:224` (parsers)
- `app/api/openai.py:116` SSE, `app/api/chat.py:259` SSE

---

## 2. Scope

**IN:** Request schema `tools`/`tool_choice`/`response_format`, parser lifts `tool_call` → `metadata`, SSE `event: tool_call` → `event: tool_result` (stub `requires_action`), `json_schema` validation with one retry.  
**OUT:** Actual tool execution (e.g., `read_file`, `run_command`), approval workflow, tool persistence.

---

## 3. Architecture After

```
Client {tools:[{type:function, function:{name,description,parameters}}], tool_choice}
  -> app/api/openai.py validates -> forward to adapter.stream(prompt, model) -> parse_line detects {"tool":...}
     -> yield text="", metadata={"tool_call": {...}} -> SSE event: tool_call
     -> yield text="", metadata={"tool_result": {"tool_call_id":..., "status":"requires_action"}}
  -> client receives tool_calls in delta.tool_calls per OpenAI spec
```

New: `app/shared/tool_schema.py` (Pydantic `ToolDef`), `app/services/tool_service.py` (validation only), `app/shared/structured_output.py`.

---

## 4. Detailed Tasks

### 4.1 S7.1 — Request Schema (`45m`)

- [ ] Extend `ChatRequest` `app/api/openai.py:27`:

```python
class FunctionDef(BaseModel):
    name: str
    description: str | None = None
    parameters: dict | None = None

class ToolDef(BaseModel):
    type: str = "function"
    function: FunctionDef

class ResponseFormat(BaseModel):
    type: str  # "json_object" | "json_schema"
    json_schema: dict | None = None

class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    tools: list[ToolDef] | None = None
    tool_choice: str | dict | None = None
    response_format: ResponseFormat | None = None
    stream: bool = False
    ...
```

- [ ] Add `app/api/chat.py:40` `MessageCreate` similarly if dashboard chat needs tools (optional — keep `ChatRequest` only for S7, dashboard stays simple).

- [ ] Validation: `tool_choice` must be `auto|none|required` or `{"type":"function","function":{"name":...}}`.

### 4.2 S7.2 — Adapter Tool Parsing (`1h`)

- [ ] For each adapter, update `parse_line`:

**Codex** `app/clients/codex.py:166` — if `json.loads(line).get("tool")` then `return "", {"tool_call": {"id":..., "name":..., "arguments":...}}`

**OpenCode** `app/clients/opencode.py:193` — similar for `part.type == "tool_call"`

**CommandCode** `app/clients/commandcode.py:224` — `event.type == "tool_call"` already has `event.get("type")` check — extend to handle `{"type":"tool_call", "tool":...}`

**Claude** `app/clients/claude.py` — check `stream-json` output for `content_block_delta` with `tool_use`.

- [ ] Add `parse_tool_result` helper in `app/clients/base.py:52` to normalize: `{"tool_call_id":..., "content":...}`.

### 4.3 S7.3 — SSE Tool Events (`45m`)

- [ ] In `app/api/openai.py:118` `event_stream`, when `metadata` contains `tool_call`, yield:

```python
if "tool_call" in metadata:
    chunk = {"id": completion_id, "object":"chat.completion.chunk", "created":..., "model": request_model,
             "choices":[{"index":0, "delta":{"tool_calls":[{"id": tc["id"], "type":"function", "function": tc}]}, "finish_reason": None}]}
    yield sse_event("tool_call", chunk, id=seq)
    # stub result
    result_meta = {"tool_call_id": tc["id"], "status":"requires_action"}
    chunk2 = {"...": "...", "choices":[{"delta":{"tool_calls":[...]}, "finish_reason":None}]}
    yield sse_event("tool_result", chunk2, id=seq+1)
```

- [ ] For non-stream `app/api/openai.py:157` `_non_stream_response`, if `result.raw` contains tool JSON, return `choices[0].message.tool_calls`.

- [ ] Keep existing `token` events `event: token` unchanged — tools intermix.

### 4.4 S7.4 — Structured Output (`45m`)

- [ ] New `app/shared/structured_output.py`:

```python
def validate_json_response(text: str, fmt: ResponseFormat) -> dict | None:
    if fmt.type == "json_object":
        try: return json.loads(text)
        except: return None
    if fmt.type == "json_schema":
        from jsonschema import validate
        data = json.loads(text)
        validate(data, fmt.json_schema)
        return data
```

- [ ] In `app/api/openai.py:160` after `result = await adapter.run`, if `request_payload.response_format`:
  - try `validate_json_response(result.text, ...)`, if `None` → retry once (re-call `adapter.run` with same prompt + `", respond with valid JSON"` suffix) or return `502 {"code":"malformed_output"}`.

- [ ] Add dep `jsonschema` to `requirements.txt` (guard: only add when needed per test-guard Rule 23 — it owns real complexity).

### 4.5 S7.5 — Client

- [ ] Dashboard maybe ignore tools for now — document `tools` is API-only via `POST /v1/chat/completions`.

---

## 5. Tests

**Unit** `tests/unit/test_tool_schema.py`:

- `test_tool_def_validates_function_name` — missing `name` → 422.
- `test_response_format_json_schema_validates` — invalid schema → 422.

**Unit** `tests/unit/test_tool_parsing.py`:

- For each adapter, feed tool JSON line, assert `parse_line` returns `tool_call` metadata.

**Contract** `tests/contract/test_tool_contract.py`:

```python
async def test_tools_returns_tool_calls_in_delta(client, user_headers):
    # seed cache, mock adapter to yield tool_call metadata
    with patch("app.api.openai.get_adapter") as m:
        m.return_value.stream = async_gen_tool_call  # yields metadata tool_call
        resp = await client.post("/v1/chat/completions", headers=user_headers, json={
            "model":"opencode//opencode/big-pickle",
            "messages":[{"role":"user","content":"use tool"}],
            "tools":[{"type":"function","function":{"name":"get_weather","parameters":{"type":"object"}}}],
            "stream": True
        })
        assert "event: tool_call" in resp.text
        assert "get_weather" in resp.text
```

**Integration** `tests/integration/test_structured_output.py`:

- `test_json_object_returns_valid_json_or_502` — mock harness returns invalid JSON, expect `502` or retry success.

Run:

```bash
.venv/bin/python -m pytest tests/contract/test_tool_contract.py -q
```

---

## 6. Verification & Exit

- [ ] `curl -X POST /v1/chat/completions -d '{"model":"opencode//opencode/big-pickle","messages":[{"role":"user","content":"hi"}],"tools":[{"type":"function","function":{"name":"x"}}]}'` → returns `tool_calls` in `choices[0].message` (mocked).
- [ ] Stream with tools → SSE contains `event: tool_call` then `event: token` order, `event: done` final.
- [ ] `response_format: {"type":"json_object"}` with harness returning `not json` → `502 malformed_output` (or retry).
- [ ] `pytest -m contract -q` includes tool tests, total ~100 tests.

**Checklist:**

- [ ] `- [x] S7 Tool Calling`

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Harness never emits tool JSON | Keep `parse_line` fallback `return text, {}` — no break. |
| `jsonschema` dep heavy | Make optional: `try: import jsonschema except: raise 501 "structured output not installed"`. |
| SSE `tool_calls` spec mismatch OpenAI | Follow `choices[0].delta.tool_calls[0].function` exactly per `docs/api.md` update. |

**Rollback:** Remove `tools` field from `ChatRequest` (Pydantic will ignore unknown `tools` if `extra="ignore"` already `app/core/config.py:40` — but we need `extra="ignore"` off for validation — keep flag to disable tools via `settings.enable_tools=false`.

