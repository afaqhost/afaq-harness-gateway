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

## Administrator User Management

User-management routes require an administrator JWT. API keys cannot access
these endpoints.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `GET` | `/api/admin/users` | List users with role and active status |
| `POST` | `/api/admin/users` | Create a user from `email`, `password`, optional `display_name`, and `role` (`user` or `admin`) |
| `PATCH` | `/api/admin/users/{user_id}` | Change one or more of `email`, `password`, `display_name`, `role`, and `is_active` |
| `DELETE` | `/api/admin/users/{user_id}` | Delete the user and their conversations, messages, API keys, quota reservations, usage records, and credential profiles |

Passwords must contain at least 8 characters and no more than 72 UTF-8 bytes.
Email uniqueness is case-insensitive. An administrator cannot delete, disable,
or demote their own account, and the gateway preserves at least one active
administrator.

Example update:

```bash
export AFAQ_ADMIN_JWT="REPLACE_WITH_DASHBOARD_JWT"

curl -X PATCH http://127.0.0.1:3500/api/admin/users/2 \
  -H "Authorization: Bearer ${AFAQ_ADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"Maintainer","role":"admin","is_active":true}'
```

A duplicate email or an unsafe self-change returns `409 conflict` in the unified
error shape. Missing users return `404 not_found`. Deletion is irreversible, so
the dashboard asks for confirmation first.

## Dashboard Project Actions

These endpoints accept dashboard JWTs only; API keys cannot use them.

| Method | Endpoint | Access | Behavior |
| --- | --- | --- | --- |
| `POST` | `/api/admin/project/update` | Administrator | Verifies a clean Git checkout and the configured GitHub origin, then runs `git pull --ff-only`. A changed revision requires a service restart. |
| `POST` | `/api/admin/project/issues` | Authenticated user | Creates a GitHub issue from `title` (3–120 characters) and `body` (10–10,000 characters) using the server-side `GITHUB_ISSUES_TOKEN`. |

Project update returns `409 project_update_conflict` for a dirty worktree,
detached branch, or concurrent update. It returns `503
project_update_unavailable` when the installation is not a Git checkout, Git is
missing, or the origin does not match `GITHUB_REPOSITORY`. Issue submission
returns `503 issue_reporting_unavailable` until a valid token is configured.
Neither endpoint returns credentials or raw Git command output.

## SSE Events & Reconnection

Streaming endpoints (`POST /v1/chat/completions` with `stream: true` and `POST /api/chat/conversations/{conv_id}/messages/stream`) emit server-sent events with structured lifecycle:
- Events: `event: start` (with `id`, `model`), `event: token` (`id`, `retry:3000`), `event: tool_call`, `event: tool_result`, `event: usage`, `event: done` (`[DONE]`), `event: error`, `event: cancel`, and `: keepalive` heartbeats every 15s.

### Reconnection Headers & Stream Identity

To ensure reliable reconnection without event collision between concurrent streams:
- `X-Stream-ID`: Identifies the specific SSE stream instance.
  - Optional on request: Clients may supply a client-generated stream ID matching 1-128 URL-safe ASCII characters (`[A-Za-z0-9_-]`).
  - Generated if omitted: The gateway assigns an opaque server-generated UUID hex stream ID.
  - Echoed on response: Returned in the `X-Stream-ID` response header for all streaming responses.
  - Key scoping: Replay history is strictly scoped by user, resource, and stream ID (`openai:{user_id}:{stream_id}` or `conv:{user_id}:{conv_id}:{stream_id}`). Unrelated streams never share sequence numbers or replay buffers.
- `Last-Event-ID`: Specifies the last event ID received by the client (non-negative integer).
- **Header Relationship & Validation Rules**:
  - Reconnecting via `Last-Event-ID` **requires** providing the matching `X-Stream-ID`. Requests sending `Last-Event-ID` without `X-Stream-ID` are rejected with `HTTP 400 Bad Request` before any child process is spawned or database record is created.
  - Malformed `X-Stream-ID` (containing spaces, colons, special characters, or exceeding 128 characters) is rejected with `HTTP 400 Bad Request`.
  - Reusing an existing `X-Stream-ID` on a new request without `Last-Event-ID` is rejected with `HTTP 409 Conflict` to prevent overwriting or appending to an existing stream.
  - Valid reconnection replays strictly the events with IDs greater than `Last-Event-ID` in sequential order without spawning duplicate subprocesses or creating duplicate user messages.
  - Reconnecting to an expired or non-existent stream ID returns `HTTP 404 Not Found`.

## Dashboard Authentication Endpoints

These routes are for the dashboard and administration, not external OpenAI clients:

- `POST /api/auth/bootstrap` creates the first administrator once.
- `POST /api/auth/login` accepts form fields `username` and `password` and returns a JWT.
- `GET /api/auth/me` returns the authenticated user.
- `POST /api/admin/keys` creates an API key and returns its raw value once.
