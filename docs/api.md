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

- `401`: missing, invalid, inactive, or unrecognized Bearer credential.
- `400`: unknown harness in the model identifier.
- `502`: the selected harness process failed.

Errors use FastAPI's JSON shape, for example:

```json
{"detail":"Authentication required. Please sign in or provide a valid API key."}
```

## Dashboard Authentication Endpoints

These routes are for the dashboard and administration, not external OpenAI clients:

- `POST /api/auth/bootstrap` creates the first administrator once.
- `POST /api/auth/login` accepts form fields `username` and `password` and returns a JWT.
- `GET /api/auth/me` returns the authenticated user.
- `POST /api/admin/keys` creates an API key and returns its raw value once.
