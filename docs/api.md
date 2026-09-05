# OpenAI-Compatible API

The public API is under `/v1`. External chat clients authenticate with an API key in the Bearer header:

```text
Authorization: Bearer afaq_YOUR_KEY
```

Dashboard chat uses the JWT from `/api/auth/login` automatically, so you do **not** need to create an API key to chat in the dashboard. Both `afaq_...` API keys and JWTs are accepted as `Bearer` tokens for `/v1/chat/completions`.

## List Models

```bash
curl http://127.0.0.1:3500/v1/models
```

The endpoint does not require authentication. The response is an object with a `data` array. Each item includes `id`, `object`, `created`, and `owned_by`. Model discovery is cached at startup and refreshed through the dashboard Harnesses page.

## Chat Completions

```bash
curl http://127.0.0.1:3500/v1/chat/completions \
  -H "Authorization: Bearer afaq_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"opencode//opencode/big-pickle","messages":[{"role":"user","content":"Hello"}]}'
```

The request accepts `model`, `messages`, and optional `stream`, `temperature`, `max_tokens`, `user`, and `metadata` fields. Each message has `role` and `content`.

The non-streaming response includes `id`, `object`, `created`, `model`, `choices`, and `usage`. The assistant text is at `choices[0].message.content`.

## Streaming

Set `stream` to `true`:

```bash
curl -N http://127.0.0.1:3500/v1/chat/completions \
  -H "Authorization: Bearer afaq_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"opencode//opencode/big-pickle","stream":true,"messages":[{"role":"user","content":"Hello"}]}'
```

The endpoint returns `text/event-stream` chunks and ends with `data: [DONE]` on a successful stream.

## Error Responses

All errors use unified shape:

```json
{"error":{"code":"validation_error","message":"...","type":"validation_error","retryable":false}}
```

Codes:

| Code | Status | Description |
| --- | --- | --- |
| `auth_error` | 401 | missing, invalid, inactive, or unrecognized Bearer credential |
| `validation_error` | 400 | unknown harness, invalid tool_choice/response_format |
| `model_forbidden` | 403 | model not allowed for API key (`allowed_models`) |
| `not_found` | 404 | harness, job, conversation, credential not found |
| `conflict` | 409 | duplicate credential profile |
| `rate_limited` | 429 | global or quota limit exceeded (`Retry-After` header) |
| `quota_exceeded` | 429 | daily/monthly quota exceeded |
| `harness_error` | 502/504 | harness process failed or timed out |
| `malformed_output` | 502 | `response_format` JSON validation failed |

Example:

```json
{"error":{"code":"auth_error","message":"Authentication required","type":"auth_error","retryable":false}}
```

## Request IDs

Every response includes `X-Request-ID` (echoes incoming or generated `uuid4` 12 hex). Logs include it as `request_id` in JSON (`app/middleware/logging.py`).

## Metrics

`GET /metrics` returns Prometheus text (`prometheus_client` required, else `501`). Counters: `afaq_requests_total`, `afaq_harness_calls_total`, `afaq_harness_latency_ms`.

## Tool Calling

`POST /v1/chat/completions` accepts OpenAI-compatible `tools` and `tool_choice` (`auto|none|required` or `{"type":"function","function":{"name":...}}`). When harness emits `tool_call` via `parse_line`, SSE yields `event: tool_call` then `event: tool_result` (`requires_action`). Non-stream returns `tool_calls` in `choices[0].message`.

## Structured Output

`response_format: {"type":"json_object"}` or `{"type":"json_schema","json_schema":{...}}` — validated via `app/shared/structured_output.py` (one retry) else `502 malformed_output`.

## Key Rotation

`POST /api/admin/keys/{id}/rotate` returns new `key` (old revoked immediately).

## SSE Events

`event: start` (with `id`, `model`), `event: token` (`id`, `retry:3000`), `event: usage`, `event: done` (`[DONE]`), `event: error`, `event: cancel`, `event: log`/`done` for harness jobs, `: keepalive` every 15s, `Last-Event-ID` replay.

## Dashboard Authentication Endpoints

These routes are for the dashboard and administration, not external OpenAI clients:

- `POST /api/auth/bootstrap` creates the first administrator once.
- `POST /api/auth/login` accepts form fields `username` and `password` and returns a JWT.
- `GET /api/auth/me` returns the authenticated user.
- `POST /api/admin/keys` creates an API key and returns its raw value once.
