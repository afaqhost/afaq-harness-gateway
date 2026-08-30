# Afaq Harness Gateway — Capability Audit for Afaq One

**Date:** 2026-08-30  
**Auditor:** Principal Software Architect  
**Repository:** `/home/nasser/Downloads/afaq-harness-gateway`  
**Scope:** Complete, evidence-based capability audit of the existing Gateway codebase  
**Verdict:** **PARTIALLY** — sufficient for a minimal ChatGPT-like client with severe production-readiness gaps; major missing backend capabilities.

---

## 1. Executive Summary

The Afaq Harness Gateway is a **FastAPI application** (Python 3.12) that exposes an OpenAI-compatible API surface (`/v1/models`, `/v1/chat/completions`) and a JWT-authenticated dashboard API (`/api/chat/conversations`, `/api/auth/*`, `/api/admin/*`). It persists conversations, messages, API keys, users, and usage records in SQLite.

**Evidence-based finding:** The Gateway supports *chat* (create conversation, send message, stream response, list/rename/delete conversations, model selection) but is missing or has stub implementations for: cancel generation, retry, regenerate, edit message, system instructions, file uploads, image inputs, tool/function calling, structured output, custom assistants, harness installation (stub only), harness health checking, credential profiles, key rotation, rate limiting, usage history API, request IDs, correlation IDs, metrics, structured logging, redaction, SSE heartbeats, stream reconnection, pagination, idempotency, and API versioning.

The codebase also contains **dead code**: `app/application/chat_service.py` (ChatService class), `app/domain/harness.py` (HarnessPort protocol, ChatInput/ChatOutput) are never imported by any API endpoint. The `stream` field on `MessageCreate` is accepted but ignored (`if data.stream: pass`). The `encrypt_secret`/`decrypt_secret` functions exist but are never called. The `CredentialProfile` and `AuthenticationStatus` types mentioned in the product context do not exist as code.

**No tests exist.** The `tests/` directory is empty. `test.py` is a smoke-test curl script, not a test suite. The README explicitly states: "The repository currently has no configured test runner."

---

## 2. Current Gateway Capability Score

**Score: 32 / 100**

| Dimension | Score | Rationale |
|---|---|---|
| API surface completeness | 45/100 | Core chat + conversation CRUD + models + auth + keys covered, but streaming is incomplete (no cancel, no tool events), no files, no tools, no assistants |
| Data model maturity | 40/100 | SQLite schema exists but missing archive/soft-delete, missing file/message attachments, no usage aggregates |
| Authentication & authorization | 55/100 | JWT + API keys with bcrypt/SHA-256 hashing; admin/user roles; per-user isolation; but no scopes, no sessions/revocation, no MFA, per-key limits NOT enforced |
| Streaming protocol | 45/100 | SSE works for token deltas but no heartbeats, no event IDs, no reconnect, no tool events, no lifecycle events, no cancellation |
| Harness integration | 60/100 | 4 adapters (Codex, OpenCode, Claude, Command Code) with install/run/stream/list_models; but install endpoint is a stub, no health checks, auth is a manual stub |
| Production readiness | 15/100 | No rate limiting, no tests, no structured logging, no metrics, no observability, single-node SQLite, no graceful shutdown for subprocesses, docker.sock mounted |
| Mobile API compatibility | 25/100 | No pagination, no idempotency, no versioning, no error standardization, 600s timeout too long, no reconnectable streams |
| Security | 40/100 | Keys hashed, secrets encrypted (but unused), input validation partial; no rate limiting, no output sanitization, error messages leak internals, docker.sock risk |

---

## 3. Afaq One Backend Readiness Score

**Score: 28 / 100**

The Gateway can support a **basic** ChatGPT-like experience (streaming text chat with conversation history and management) but cannot support the full ChatGPT-class feature set. Critical blockers include: no file/image attachments, no tool calling, no custom assistants, no stop/cancel, no retry/regenerate, no system instructions, no rate limiting, no usage API, no production observability, and no test coverage.

---

## 4. Capability Matrix

### A. CHAT

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| create conversation | Yes | Yes | `POST /api/chat/conversations` creates Conversation with title+model | `/api/chat/conversations` POST | No | Yes (SQLite) | JWT | Low | Full | None | Low |
| send message | Yes | Yes | `POST /api/chat/conversations/{id}/messages` calls `adapter.run()` | `/api/chat/conversations/{id}/messages` POST | No (non-streaming only) | Yes | JWT | Low | Full | None | Low |
| stream response | Yes | Partial | `POST /api/chat/conversations/{id}/messages/stream` yields SSE | `/api/chat/conversations/{id}/messages/stream` POST | Yes (SSE) | Yes (after stream completes) | JWT | Medium | Partial | Add cancellation, tool events, metadata events | High |
| cancel generation | Yes | **No** | No endpoint exists; client must abort HTTP request; no process kill | None | No | No | N/A | Critical | Missing | Server-side process cancellation, SSE `event: cancel` | Critical |
| retry | Yes | **No** | Frontend `retryMessage()` shows "coming soon" toast | None | No | No | N/A | Medium | Missing | Retry endpoint, message persistence, SSE resume | High |
| regenerate | Yes | **No** | No endpoint or UI action | None | No | No | N/A | Medium | Missing | Regenerate endpoint | High |
| edit user message | Yes | **No** | No PATCH on messages, no edit endpoint | None | No | No | N/A | Medium | Missing | Edit + regenerate endpoint | High |
| system instructions | Yes | **No** | Messages are only `role` in {user, assistant}; no system role support | None | No | No | N/A | Medium | Missing | System prompt injection per conversation/assistant | High |
| conversation context | Yes | Yes | Full conversation history joined into prompt (`"\n".join(f"{m.role}: {m.content}")`) | `/messages` POST, `/messages/stream` POST | No (context sent as full history) | Yes | JWT | Low | Full | None | Low |
| conversation title | Yes | Yes | Auto-generated from first message preview (50 chars), or user-set via PATCH | PATCH `/conversations/{id}` | No | Yes | JWT | Low | Full | None | Low |
| conversation metadata | Partial | **No** | Only id, title, model, timestamps; no system instructions, no custom fields | None | No | No | N/A | Low | Missing | Message metadata, custom fields | Medium |

### B. CONVERSATION MANAGEMENT

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| list conversations | Yes | Yes | `GET /api/chat/conversations` returns all for user, ordered by updated_at DESC | GET `/conversations` | No | Yes | JWT | Low | Full | Pagination, filtering | Medium |
| get conversation | Yes | Yes | `GET /api/chat/conversations/{id}` returns detail with messages | GET `/conversations/{id}` | No | Yes | JWT | Low | Full | None | Low |
| rename | Yes | Yes | `PATCH /api/chat/conversations/{id}` with `{title}` | PATCH `/conversations/{id}` | No | Yes | JWT | Low | Full | None | Low |
| archive | Yes | **No** | No archive flag; delete is permanent (`DELETE /api/chat/conversations/{id}`) | None | No | No | N/A | Medium | Missing | Archive flag, restore, filtered list | Medium |
| delete | Yes | Yes | `DELETE /api/chat/conversations/{id}` — hard delete | DELETE `/conversations/{id}` | No | Yes (removed) | JWT | Medium | Full | Soft-delete/archive, restore | Medium |
| restore | Yes | **No** | Deleted conversations are gone | None | No | No | N/A | Low | Missing | Restore from soft-delete | Low |
| pagination | Yes | **No** | `list_conversations` returns all with no limit/offset | None | No | No | N/A | Low | Missing | `limit`/`offset` query params | Medium |
| search | Yes | **No** | No search endpoint | None | No | No | N/A | Low | Missing | Search by title/content | Medium |
| sorting | Partial | Yes | Ordered by `desc(Conversation.updated_at)` | GET `/conversations` | No | Yes | JWT | Low | Full | None | Low |
| sync | Yes | **No** | No sync token/version mechanism | None | No | No | N/A | Medium | Missing | Sync token, incremental sync | High |

### C. MODELS

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| list models | Yes | Yes | `GET /v1/models` returns cached models from `MODEL_CACHE` | GET `/v1/models` | No | No (in-memory cache) | None (no auth) | Medium | Partial | Include capability metadata | Medium |
| model metadata | Partial | Partial | Only `id`, `object`, `created`, `owned_by` | GET `/v1/models` | No | No | No | Low | Partial | Add description, context_window, pricing | Medium |
| model capabilities | Yes | **No** | `HarnessModel` has `context_window` and `pricing` fields but `list_models()` for OpenCode returns `None`; for Codex returns default; for Claude returns hardcoded list with no context_window | None | No | No | N/A | Low | Missing | Capability metadata in cache | Medium |
| model limits | Yes | **No** | No token limits per model | None | No | No | N/A | Low | Missing | Token limits | Medium |
| model availability | Partial | Partial | Harness `installed` and `authenticated` flags in `/api/admin/harnesses` | GET `/api/admin/harnesses` | No | No | JWT | Low | Partial | Per-model availability, status | Medium |
| model status | Yes | **No** | No per-model health/status | None | No | No | N/A | Low | Missing | Model status endpoint | Medium |
| model selection | Yes | Yes | Via model identifier in chat request (e.g., `opencode//model`) | POST chat completions | Yes | No | JWT/API key | Low | Full | None | Low |
| model fallback | Yes | **No** | If harness fails, 502 error; no automatic fallback | None | No | No | JWT | Medium | Missing | Fallback chain, retry on alternate model | High |
| model aliases | Yes | **No** | No alias system | None | No | No | N/A | Low | Missing | Alias → real model ID mapping | Low |
| provider/harness metadata | Partial | Partial | `/api/admin/harnesses` returns name, display_name, provider, installed, authenticated, models | GET `/api/admin/harnesses` | No | No | JWT | Low | Partial | Add version, capabilities, health | Medium |

### D. FILES

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| file upload | Yes | **No** | `uploads_dir` config exists but no endpoint uses it | None | No | No | N/A | Critical | Missing | Upload endpoint, MIME validation, size limits | Critical |
| file download | Yes | **No** | No endpoint | None | No | No | N/A | Critical | Missing | Download endpoint | Critical |
| file metadata | Yes | **No** | No file table in DB | None | No | No | N/A | Critical | Missing | File metadata schema | Critical |
| attach file to conversation | Yes | **No** | No attachment mechanism | None | No | No | N/A | Critical | Missing | Attachment linking to messages | Critical |
| document processing | Yes | **No** | No endpoint | None | No | No | N/A | Critical | Missing | Document parsing, chunking | Critical |
| image input | Yes | **No** | `ChatMessage` schema: `role: str, content: str` — text only, no images | None | No | No | N/A | Critical | Missing | Image URL/content support, MIME validation | Critical |
| file deletion | Yes | **No** | No endpoint | None | No | No | N/A | Medium | Missing | Delete endpoint | Critical |
| size limits | Yes | **No** | No size validation | None | No | No | N/A | Medium | Missing | MAX_UPLOAD_SIZE config, enforcement | Critical |
| MIME validation | Yes | **No** | No file handling | None | No | No | N/A | High | Missing | MIME type allow-list | Critical |
| storage lifecycle | Yes | **No** | No file management | None | No | No | N/A | Low | Missing | File cleanup, retention | Low |

### E. TOOLS

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| tool definitions | Yes | **No** | No tool schema in request body or adapter | None | No | No | N/A | Critical | Missing | Tools array in ChatRequest, tool routing | Critical |
| function calling | Yes | **No** | No function call parsing in adapters | None | No | No | N/A | Critical | Missing | Tool call extraction from harness output | Critical |
| tool invocation | Yes | **No** | No mechanism | None | No | No | N/A | Critical | Missing | Tool execution, result injection | Critical |
| tool result handling | Yes | **No** | No mechanism | None | No | No | N/A | Critical | Missing | Tool result persistence, re-prompting | Critical |
| tool approval | Yes | **No** | No approval workflow | None | No | No | N/A | High | Missing | Approval endpoint, pending state | Critical |
| tool execution status | Yes | **No** | No mechanism | None | No | No | N/A | Medium | Missing | Tool status tracking | High |
| streamed tool events | Yes | **No** | SSE only includes content deltas; no `event: tool_call`, `event: tool_result` | None | No | No | N/A | High | Missing | Tool event SSE format | Critical |

### F. STRUCTURED OUTPUT

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| JSON mode | Yes | **No** | No response_format parameter | None | No | No | N/A | Medium | Missing | response_format in ChatRequest | High |
| JSON schema | Yes | **No** | No schema parameter | None | No | No | N/A | High | Missing | json_schema parameter support | High |
| typed responses | Yes | **No** | No mechanism | None | No | No | N/A | Medium | Missing | Structured output parsing | High |
| validation | Yes | **No** | No validation of structured output | None | No | No | N/A | Medium | Missing | Output schema validation | High |
| malformed-output recovery | Yes | **No** | No mechanism | None | No | No | N/A | Medium | Missing | Retry/recovery logic | High |

### G. CUSTOM GPTs / ASSISTANTS

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| create custom assistant | Yes | **No** | No assistants table or API | None | No | No | N/A | Critical | Missing | Full assistant CRUD API | Critical |
| assistant metadata | Yes | **No** | No schema | None | No | No | N/A | Critical | Missing | Assistant model with id/name/description/avatar/instructions | Critical |
| assistant instructions | Yes | **No** | No system prompt support | None | No | No | N/A | High | Missing | System instructions injection | High |
| model selection | Yes | Partial | Per-conversation model in PATCH | PATCH `/conversations/{id}` | No | Yes | JWT | Low | Partial | Per-assistant model selection | High |
| tool configuration | Yes | **No** | No tools support | None | No | No | N/A | Critical | Missing | Tool assignment to assistant | Critical |
| knowledge/files | Yes | **No** | No file support | None | No | No | N/A | Critical | Missing | File/knowledge base linking | Critical |
| update assistant | Yes | **No** | No endpoint | None | No | No | N/A | Critical | Missing | PATCH assistant | Critical |
| delete assistant | Yes | **No** | No endpoint | None | No | No | N/A | High | Missing | DELETE assistant | Critical |
| list assistants | Yes | **No** | No endpoint | None | No | No | N/A | Critical | Missing | GET assistants | Critical |
| invoke assistant | Yes | Partial | Chat endpoint with model identifier is closest | POST `/chat/completions` | Yes | Yes | JWT/API key | Low | Partial | Assistant-specific invocation | High |
| assistant conversation context | Yes | **No** | No assistant concept | None | No | No | N/A | Critical | Missing | Assistant context persistence | Critical |

### H. AGENTS / HARNESSES

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| harness discovery | Yes | Yes | `GET /api/admin/harnesses` returns name, display_name, provider, installed, authenticated, models | GET `/admin/harnesses` | No | No (in-memory + DB row) | JWT | Low | Full | None | Low |
| harness installation | Partial | **Stub** | `POST /api/admin/harnesses/{name}/install` returns `{"status":"accepted","message":"Use the installation stream endpoint in the next UI integration."}` — does NOT call `adapter.install()` | POST `/admin/harnesses/{name}/install` | No | No | Admin | Medium | Stub | Actual install job, progress stream, status tracking | High |
| harness lifecycle | **No** | `install()` and `update()` methods exist on adapters but no endpoint calls them | `Adapter.install()`, `Adapter.update()` yield progress events but are unused | None (install endpoint is stub) | No | No | N/A | Medium | Missing | Lifecycle job manager | High |
| health checking | **No** | `/health` checks gateway only; no per-harness health endpoint | `GET /health` returns `{"status":"ok","service":...,"version":...}` | GET `/health` | No | No | No | Medium | Missing | Per-harness health check | High |
| authentication | Partial | `authenticate()` method returns static `{"status":"manual_required"}` stub | `HarnessAdapter.authenticate()` never actually authenticates | None | No | No | N/A | Medium | Stub | Real credential profile management | High |
| credentials | **No** | `CredentialProfile` and `AuthenticationStatus` mentioned in product context but do not exist in code; `encrypt_secret`/`decrypt_secret` exist but never called | `app/core/security.py` has `encrypt_secret`/`decrypt_secret` — dead code | None | No | No | N/A | Medium | Missing | Credential profile CRUD, encrypted storage | High |
| harness capabilities | **No** | No capability metadata per harness | `ADAPTERS` dict has no capabilities field | None | No | No | N/A | Low | Missing | Capability metadata | Medium |
| routing | Yes | Yes | `split_model()` parses `harness//model`, `get_adapter()` resolves | All chat endpoints | Yes | No | JWT/API key | Low | Full | Fallback routing | Medium |
| per-harness configuration | **No** | `Harness.config` JSON column exists on DB model but no endpoint to set it | `Harness.config` column — no CRUD | None | No | No | N/A | Low | Missing | Per-harness config API | Medium |
| process execution | Yes | Yes | `Adapter.run()` and `Adapter.stream()` use `asyncio.create_subprocess_exec` | Internal to adapter | Yes | No | N/A | Low | Full | None | Low |
| process cleanup | **No** | No process cleanup on cancellation/timeout | On cancel, subprocess continues until `harness_timeout_seconds` (600s) | None | No | No | N/A | Critical | Missing | Process termination on disconnect | High |
| long-running execution | Yes | Yes | `harness_timeout_seconds=600` | Internal to adapter | Yes | No | N/A | Low | Full | None | Low |
| streaming | Yes | Yes | `Adapter.stream()` yields text+metadata | `/v1/chat/completions` stream, `/messages/stream` | Yes (SSE) | Yes (after completion) | JWT/API key | Low | Full | None | Low |
| cancellation | **No** | No cancellation mechanism | Client abort does not kill subprocess | None | No | No | N/A | Critical | Missing | Server-side process kill | Critical |

### I. AUTHENTICATION

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| API keys | Yes | Yes | `POST /api/admin/keys` creates, `GET /api/admin/keys` lists, `PATCH /keys/{id}` toggles, `DELETE /keys/{id}` deletes; SHA-256 hashed, shown once | POST/GET/PATCH/DELETE `/admin/keys` | No | Yes (SQLite) | JWT | Low | Full | Key rotation | Medium |
| user identity | Yes | Yes | Email/password registration via admin/bootstrap; JWT tokens | POST `/auth/login`, POST `/auth/bootstrap` | No | Yes | N/A | Low | Full | Self-service registration | Medium |
| sessions | **No** | No | Stateless JWT; no session store, no revocation | None | No | No | N/A | High | Missing | Session management, revocation | High |
| credential profiles | **No** | Referenced in product context but not implemented | `CredentialProfile` type does not exist in code | None | No | No | N/A | Medium | Missing | Credential profile CRUD API | High |
| secret storage | Partial | `encrypt_secret`/`decrypt_secret` exist but NEVER called | `app/core/security.py` functions — dead code | None | No | No | N/A | Medium | Stub | Actual secret storage using these functions | High |
| authentication status | **No** | `AuthenticationStatus` type mentioned but not implemented | Does not exist in code | None | No | No | N/A | Low | Missing | Auth status endpoint per harness | Medium |
| key rotation | **No** | No rotation endpoint | `generate_api_key` creates new but no rotate action | None | No | No | N/A | Medium | Missing | Key rotation endpoint | Medium |
| revocation | Yes | Yes (disable) | PATCH `/keys/{id}` toggles `is_active` | PATCH `/admin/keys/{id}` | No | Yes | JWT | Low | Full | Full delete (already exists) | Low |
| authorization scopes | **No** | No scopes in JWT or API key | JWT payload: `{"sub":..., "exp":...}` only | None | No | No | N/A | High | Missing | Scope-based authorization | High |
| per-user isolation | Yes | Yes | All conversation/message queries filter by `user_id` | All chat endpoints | No | Yes | JWT | Low | Full | None | Low |

### J. USAGE & LIMITS

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| request limits | Partial | **Not enforced** | `daily_limit`/`monthly_limit` columns exist but never checked | None (config only) | No | No (stored, not enforced) | N/A | High | Missing | Enforcement in request middleware | Critical |
| token usage | Partial | Yes | `UsageRecord` table with prompt/completion/cached/total tokens | None (recorded, not queryable) | No | Yes (SQLite) | JWT | Low | Partial | Usage history API endpoint | Medium |
| execution duration | Partial | Yes | `latency_ms` in UsageRecord | None | No | Yes | N/A | Low | Full | None | Low |
| queue status | **No** | No queue exists | No queueing system; requests spawn subprocess directly | None | No | No | N/A | Medium | Missing | Queue implementation | Medium |
| quota | **No** | No quota system | No quota concept | None | No | No | N/A | Medium | Missing | Quota management | Medium |
| rate limiting | **No** | No rate limiting | No middleware, no limits | None | No | No | N/A | Critical | Missing | Rate limiting middleware (Redis-based) | Critical |
| per-key controls | Partial | **Not enforced** | `allowed_models`, `daily_limit`, `monthly_limit` on APIKey model but never checked in `resolve_identity` or chat endpoints | None | No | No (stored, not enforced) | N/A | Critical | Missing | Enforcement in auth middleware | Critical |
| usage history | **No** | No endpoint | `usage_records` table exists but no `GET` endpoint queries it | None | No | No | N/A | Medium | Missing | Usage history/list endpoint | Medium |

### K. ERRORS

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| standardized error format | **No** | Inconsistent | HTTP errors use FastAPI `{"detail": "..."}`; streaming errors use `{"error":{"message":...,"type":"harness_error"}}` | Multiple | No | No | N/A | Medium | Missing | Unified error schema | Medium |
| machine-readable error codes | **No** | No | No error codes/enums | None | No | No | N/A | Medium | Missing | Error code enum | Medium |
| retryable errors | **No** | No | No distinction between retryable/non-retryable | None | No | No | N/A | Medium | Missing | Retryable flag on errors | Medium |
| provider errors | Partial | Yes | Harness error messages passed through | All chat endpoints | No | No | N/A | Medium | Partial | Structured provider error parsing | Medium |
| validation errors | Yes | Yes | FastAPI/Pydantic 422 responses for malformed requests | All POST/PUT/PATCH | No | No | N/A | Low | Full | None | Low |
| authentication errors | Yes | Yes | 401 for missing/invalid credentials | All auth-protected endpoints | No | No | N/A | Low | Full | None | Low |
| authorization errors | Yes | Yes | 403 for non-admin on admin endpoints | Admin endpoints | No | No | N/A | Low | Full | None | Low |
| timeout errors | **No** | Not handled | `asyncio.wait_for` TimeoutError would be unhandled, causing 500 | None (would be 500) | No | No | N/A | High | Missing | Explicit timeout error (408/504) | Medium |
| queue errors | N/A | No queue | No queue | None | No | No | N/A | N/A | N/A | N/A | N/A |
| cancellation errors | **No** | No | No cancellation mechanism | None | No | No | N/A | Critical | Missing | Cancellation error event | Critical |

### L. REAL-TIME

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SSE | Yes | Yes | `text/event-stream` on `/v1/chat/completions` and `/messages/stream` | POST `/v1/chat/completions`, POST `/messages/stream` | Yes | Yes (after completion) | JWT/API key | Low | Full | None | Low |
| event types | **No** | Only two types | `data: {...delta...}` and `data: [DONE]`; no `event:` field | Streaming endpoints | Yes | No | JWT | High | Missing | Distinct event types (token, tool_call, metadata, error, done) | Critical |
| heartbeats | **No** | No | No SSE comment or heartbeat | None | No | No | N/A | High | Missing | Periodic `: keepalive` events | High |
| reconnect behavior | **No** | No | No event IDs, no retry directive, no stream resumption | None | No | No | N/A | Critical | Missing | Event IDs, retry directive, resume | Critical |
| partial output | Yes | Yes | SSE delta chunks with `choices[0].delta.content` | Streaming endpoints | Yes | Yes | JWT | Low | Full | None | Low |
| tool events | **No** | No tool support | No tool_call_delta events | None | No | No | N/A | Critical | Missing | Tool event SSE format | Critical |
| lifecycle events | **No** | No | No start/complete lifecycle events | None | No | No | N/A | High | Missing | Lifecycle event types | High |
| terminal events | Yes | Yes | `data: [DONE]` marker | Streaming endpoints | Yes | No | JWT | Low | Full | None | Low |

### M. OBSERVABILITY

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| structured logs | **No** | No | No logging configuration; uses uvicorn defaults | None | No | No | N/A | Medium | Missing | Structured logging with run_id, request_id | High |
| redaction | **No** | No | No redaction of secrets in logs/errors | None | No | No | N/A | High | Missing | Redaction middleware | High |
| request IDs | **No** | No | No request ID middleware | None | No | No | N/A | High | Missing | X-Request-ID middleware | High |
| correlation IDs | **No** | No | No correlation IDs | None | No | No | N/A | High | Missing | Correlation ID propagation | High |
| metrics | **No** | No | No Prometheus or metrics endpoint | None | No | No | N/A | Medium | Missing | /metrics endpoint, Prometheus exports | Medium |
| tracing | **No** | No | No distributed tracing | None | No | No | N/A | Medium | Missing | OpenTelemetry integration | Medium |
| audit logging | **No** | No | No audit trail of actions | None | No | No | N/A | High | Missing | Audit log table + middleware | High |

### N. SECURITY

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| authentication | Yes | Yes | JWT + API keys | Various | Various | Yes | Various | Low | Full | Key rotation, sessions | Medium |
| authorization | Yes | Yes | Admin/user roles, per-user isolation | Admin endpoints | No | Yes | JWT | Low | Full | Scopes, resource-level permissions | High |
| input validation | Partial | Partial | Pydantic models validate; 20000 char limit; but messages accept arbitrary content as CLI arguments | All POST endpoints | No | No | JWT | Medium | Partial | Content sanitization, size limits per field | Medium |
| output validation | **No** | No | No sanitization of harness output before sending to client | Streaming/chat | No | No | N/A | High | Missing | Output sanitization/malformed recovery | High |
| SSRF protection | N/A | No SSRF risk | Gateway makes no outbound HTTP requests | N/A | N/A | N/A | N/A | Low | N/A | N/A | N/A |
| file validation | **No** | No file handling | No upload/validation | None | No | No | N/A | Medium | Missing | File validation pipeline | High |
| path traversal | **No** | No file endpoints | No file download/upload to validate | None | No | No | N/A | Low | N/A | N/A | N/A |
| command injection | Partial | **Mitigated at subprocess level** | Uses `create_subprocess_exec` (not shell); commands built as list args; but prompt content is passed as argument which is safe from shell injection | Internal to adapter | No | No | N/A | Medium | Partial | Input sanitization of prompt content | Medium |
| secret leakage | **High Risk** | Partial | API key hashes stored; `allowed_models`/`daily_limit`/`monthly_limit` NOT enforced; error messages leak harness internals (e.g., stderr output in `RuntimeError` messages); debug=True exposes stack traces | All endpoints | No | No | N/A | High | Missing | Error sanitization, limit enforcement | Critical |
| tenant isolation | Yes | Yes | All conversation/message queries filter by `user_id` | All chat endpoints | No | Yes | JWT | Low | Full | None | Low |
| rate limiting | **No** | No | No rate limiting middleware | None | No | No | N/A | Critical | Missing | Rate limiting (Redis-based) | Critical |
| abuse protection | **No** | No | No rate limiting, no usage enforcement, no anomaly detection | None | No | No | N/A | Critical | Missing | Abuse detection, request limits, quotas | Critical |

### O. MOBILE CLIENT REQUIREMENTS

| Capability | Required? | Gateway Support | Evidence | Endpoint(s) | Streaming? | Persistence? | Auth? | Risk | Completeness | Missing Work | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| stable JSON contracts | Partial | No spec | No OpenAPI contract; shapes are implicit in code | Various | Various | Various | Various | Medium | Partial | OpenAPI spec, contract tests | Medium |
| pagination | **No** | No | Conversation list returns all; no `limit`/`offset` or cursor | GET `/conversations`, GET `/models` | No | No | N/A | Medium | Missing | Pagination params | Medium |
| idempotency | **No** | No | No idempotency key support | None | No | No | N/A | High | Missing | Idempotency-Key header support | Medium |
| resumable/reconnectable streams | **No** | No | SSE has no event IDs, no `retry`, no resume | None | No | No | N/A | Critical | Missing | Event IDs, retry directive, resume token | Critical |
| backward compatibility | **No** | No | No versioning strategy; `/v1` is implicit | Various | Various | Various | Various | Medium | Partial | Versioning policy, deprecation headers | Medium |
| versioning | **No** | No | Only `/v1` prefix; no version discovery or negotiation | Various | Various | Various | Various | Medium | Missing | API versioning strategy | Medium |
| compact responses | **No** | No | Responses include all available fields; no field selection | Various | Various | Various | Various | Low | Missing | Field selection (fields parameter) | Low |
| predictable errors | **No** | No | Inconsistent error shapes (FastAPI default vs custom) | Multiple | No | No | N/A | Medium | Missing | Unified error schema with codes | Medium |
| mobile-friendly timeouts | **No** | No | 600s harness timeout is too long for mobile; no per-endpoint timeout | None | No | No | N/A | High | Missing | Shorter mobile-friendly timeouts | Medium |
| offline-safe persistence | **No** | No | No sync/offline strategy | None | No | No | N/A | Medium | Missing | Sync strategy, local cache invalidation | Medium |
| sync strategy | **No** | No | No sync mechanism | None | No | No | N/A | Medium | Missing | Sync tokens, incremental sync | Medium |

---

## 5. Full API Inventory

### Page Routes (HTML, server-rendered)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | None | Dashboard root → renders chat page |
| GET | `/login` | None | Login page |
| GET | `/chat` | None (client-side check) | Chat page |
| GET | `/harnesses` | None (client-side check) | Harnesses page |
| GET | `/keys` | None (client-side check) | API keys page |
| GET | `/users` | None (client-side check) | Users page |
| GET | `/documentation` | None (client-side check) | Docs page |
| GET | `/health` | None | Health check: `{"status":"ok","service":"Afaq Harness Gateway","version":"0.1.0"}` |
| GET | `/static/*` | None | Static files (CSS, JS, images) |
| GET | `/docs` | None | FastAPI auto-generated Swagger UI |
| GET | `/redoc` | None | FastAPI auto-generated ReDoc |

### OpenAI-Compatible API (`/v1` prefix)

| Method | Path | Auth | Request Body | Response | Streaming |
|---|---|---|---|---|---|
| GET | `/v1/models` | **None** | None | `{"object":"list","data":[{"id","object":"model","created","owned_by"}]}` | No |
| POST | `/v1/chat/completions` | Bearer (JWT or API key) | `{model, messages:[{role,content}], stream, temperature, max_tokens, user, metadata}` | OpenAI chat completion or SSE stream | Yes (when `stream:true`) |

**Evidence:** `app/api/openai.py` lines 71-112. `resolve_identity()` accepts both JWT (2-dot format) and API key (afaq_ prefix). `temperature` and `max_tokens` are accepted but **never passed to the harness adapter**.

### Auth API (`/api/auth` prefix)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| POST | `/api/auth/bootstrap` | None (only when DB has 0 users) | `{email, password, display_name}` | `UserOut` |
| POST | `/api/auth/login` | None | OAuth2 form: `username`, `password` | `{access_token, token_type:"bearer", user}` |
| GET | `/api/auth/me` | JWT | None | `UserOut` |

**Evidence:** `app/api/auth.py` lines 38-56. The `current_user` dependency decodes JWT via `jose.jwt.decode`. No refresh token. No session revocation.

### Admin API (`/api/admin` prefix)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/api/admin/harnesses` | JWT | None | `[{name, display_name, provider, installed, authenticated, models}]` |
| POST | `/api/admin/harnesses/refresh` | JWT | None | `{"status":"refreshed"}` |
| POST | `/api/admin/harnesses/{name}/install` | Admin | None | `{"status":"accepted","message":"Use the installation stream endpoint..."}` (STUB) |
| POST | `/api/admin/users` | Admin | `{email, password, display_name, role}` | `{id, email, role}` |
| GET | `/api/admin/users` | Admin | None | `[{id, email, display_name, role, is_active}]` |
| POST | `/api/admin/keys` | JWT | `{name, daily_limit?, monthly_limit?, allowed_models?}` | `{id, name, key, prefix, warning}` (raw key shown once) |
| GET | `/api/admin/keys` | JWT | None | `[{id, name, prefix, is_active, daily_limit, monthly_limit, last_used_at}]` |
| PATCH | `/api/admin/keys/{key_id}` | JWT | None (toggles active) | `{id, is_active}` |
| DELETE | `/api/admin/keys/{key_id}` | JWT | None | 204 No Content |

**Evidence:** `app/api/admin.py` lines 25-82. The install endpoint at line 44 returns a stub message and does NOT call `adapter.install()`.

### Chat API (`/api/chat` prefix)

| Method | Path | Auth | Request Body | Response | Streaming |
|---|---|---|---|---|---|
| GET | `/api/chat/conversations` | JWT | None | `[ConversationOut]` (all conversations) | No |
| POST | `/api/chat/conversations` | JWT | `{title?, model?}` | `ConversationOut` | No |
| GET | `/api/chat/conversations/{id}` | JWT | None | `ConversationDetail` (with messages) | No |
| PATCH | `/api/chat/conversations/{id}` | JWT | `{title?, model?}` | `ConversationOut` | No |
| DELETE | `/api/chat/conversations/{id}` | JWT | None | 204 No Content | No |
| POST | `/api/chat/conversations/{id}/messages` | JWT | `{content, model?, stream?}` | `{conversation, message, usage}` | No (stream field ignored) |
| POST | `/api/chat/conversations/{id}/messages/stream` | JWT | `{content, model?, stream?}` | SSE stream | Yes (SSE) |

**Evidence:** `app/api/chat.py` lines 90-325. CRITICAL: `MessageCreate` has a `stream` field (line 29), but in `send_message()` (line 189): `if data.stream: pass` — the field is accepted and silently ignored. Streaming is ONLY available via the separate `/messages/stream` endpoint. No cancel, no retry, no regenerate.

### Undocumented Endpoints

- `GET /docs` and `GET /redoc` — FastAPI auto-generated OpenAPI docs. The `/docs` page exposes the full API schema. This is **not documented** in any project doc.
- All HTML page routes (`/`, `/login`, `/chat`, etc.) are not documented in docs/api.md.
- The `/api/admin/harnesses/{name}/install` stub is not documented.

### Internal-only Endpoints

- `POST /api/admin/harnesses/{name}/install` — stubs the actual installation logic.
- `POST /api/admin/harnesses/refresh` — rebuilds model cache.

### Dead Routes

- `GET /api/admin/users` supports listing but there is no user detail, update, or delete endpoint — only create.
- The `stream` field on `MessageCreate` is dead code (`if data.stream: pass`).
- `ChatService` in `app/application/chat_service.py` is never imported by any endpoint.
- `HarnessPort` protocol in `app/domain/harness.py` defines `execute()` and `stream()` methods, but adapters implement `run()` (not `execute()`), and no endpoint uses the protocol.

### Routes with Weak Validation

- `POST /api/admin/harnesses/{name}/install` — `name` param is used to match adapter but no validation beyond KeyError.
- `POST /api/chat/conversations/{id}/messages` — model string is parsed by `split_model()` which could produce unexpected harness/model pairs with no validation against available models.
- `POST /api/admin/users` — `UserCreate.email` has no `EmailStr` validation (unlike `RegisterRequest` in auth.py which uses `EmailStr`).
- No request body size limit at the FastAPI/uvicorn level.
- `POST /v1/chat/completions` accepts `metadata`, `user`, `temperature`, `max_tokens` but silently ignores them.

### Routes with Behavior Differing from Documentation

- docs/api.md states API keys are created via `POST /api/admin/keys` — correct, but the admin.py route is registered under `/api/admin` prefix, and the docs/api.md example says `/api/admin/keys` which matches. However, the docs say "Create an API key in the dashboard" and the external client uses `Bearer afaq_YOUR_KEY` for `/v1/chat/completions` — this works correctly.
- docs/api.md states models endpoint "does not require authentication" — correct.
- docs/api.md states streaming "ends with `data: [DONE]`" — correct.
- docs/api.md says errors use FastAPI's JSON shape `{"detail": "..."}` — correct for HTTP errors, but streaming errors use `{"error":{"message":...}}` — undocumented discrepancy.

---

## 6. Missing Capabilities

### Critical Blockers (must fix before Afaq One build)

1. **File upload / image input** — No endpoint, no schema, no storage. `uploads_dir` config exists but unused.
2. **Stop/cancel generation** — No server-side cancellation; client abort leaves subprocess running for up to 600s.
3. **Tool/function calling** — No tool schema in request, no tool event parsing, no SSE tool events.
4. **Rate limiting** — No rate limiting at all; `daily_limit`/`monthly_limit` stored but never enforced.
5. **Per-key controls enforcement** — `allowed_models`, `daily_limit`, `monthly_limit` never checked.
6. **Usage history API** — `usage_records` table exists but no GET endpoint to query it.
7. **Streaming protocol completeness** — No event types, no heartbeats, no event IDs, no reconnect/resume, no lifecycle events.
8. **Command injection / prompt injection** — While `subprocess_exec` mitigates shell injection, harness output is passed through without sanitization; error messages leak stderr.
9. **No tests** — Empty tests directory; no test runner configured.

### High-Priority Missing Capabilities

10. **Custom assistants** — No assistants table, no CRUD API, no system instructions.
11. **System instructions** — No system role in messages, no prompt injection support.
12. **Retry / regenerate / edit message** — No endpoints; frontend "retry" button shows "coming soon".
13. **Conversation archive / soft-delete** — Only permanent delete exists.
14. **Pagination** — Conversation list returns all; no limit/offset.
15. **Request IDs / correlation IDs** — No tracing infrastructure.
16. **Structured logging / redaction** — No logging config; errors leak internals.
17. **Metrics / observability** — No `/metrics` endpoint, no Prometheus exports.
18. **API versioning / idempotency** — No version discovery; no idempotency keys.
19. **Error standardization** — Inconsistent error shapes (FastAPI default vs custom streaming).
20. **SSE heartbeats / reconnect** — No keepalive, no event IDs, no retry directive.
21. **Harness installation** — `POST /api/admin/harnesses/{name}/install` is a stub.
22. **Credential profiles** — `CredentialProfile` type does not exist; `encrypt_secret`/`decrypt_secret` are dead code.
23. **Harness health checks** — `/health` only checks gateway, not individual harnesses.
24. **Process cleanup on cancel** — Subprocess continues after client disconnect.
25. **Mobile-friendly timeouts** — 600s timeout too long for mobile.

### Medium-Priority Missing Capabilities

26. **Model capability metadata** — No context_window, pricing, or capability info in model listing.
27. **Model fallback** — No automatic model fallback on failure.
28. **Model aliases** — No alias system.
29. **Conversation search** — No search endpoint.
30. **Conversation sync** — No sync token mechanism.
31. **Key rotation** — No rotation endpoint.
32. **Sessions / revocation** — Stateless JWT; no revocation.
33. **Authorization scopes** — JWT has no scopes.
34. **Audit logging** — No audit trail.
35. **Self-service user registration** — Only bootstrap + admin create.
36. **JSON mode / structured output** — No `response_format` support.
37. **Agent/harness lifecycle management** — No job manager for install/update.
38. **Multi-harness routing** — Only single harness via model prefix; no intelligent routing.
39. **Output sanitization** — No sanitization of harness output.
40. **Timeout errors** — `asyncio.wait_for` TimeoutError unhandled → 500.

### Low-Priority Missing Capabilities

41. **Soft message delete / edit** — No PATCH on messages.
42. **User profile management** — No endpoint for users to update their own profile.
43. **Dark mode toggle** — Frontend only supports language toggle, not theme.
44. **Notification system** — No WebSocket or push notifications.
45. **API versioning strategy** — Only `/v1` prefix, no formal versioning.

---

## 7. Critical Blockers

| # | Blocker | File | Evidence | Impact |
|---|---|---|---|---|
| 1 | No file upload / image input | `app/api/openai.py` | `ChatMessage` schema: `role: str, content: str` — text only; no `attachments_dir`/file schema | Cannot support image-based queries |
| 2 | No cancel/stop generation | `app/api/chat.py` | `stream_message()` event_stream has no cancellation; no `/cancel` endpoint; `adapter.stream()` has no stop mechanism | Cannot stop long-running generation |
| 3 | No tool/function calling | `app/api/openai.py`, `app/api/chat.py` | `ChatRequest` has no `tools` field; adapters' `parse_line()` doesn't handle tool calls | Cannot support agentic workflows |
| 4 | No rate limiting | `app/main.py` | No rate limiting middleware; `daily_limit`/`monthly_limit` on APIKey never checked in `resolve_identity` or any endpoint | Abuse/DDoS vulnerability |
| 5 | No tests | `tests/` directory | Empty directory; README: "no configured test runner"; `test.py` is a curl smoke test | No regression protection |
| 6 | Dead code — ChatService | `app/application/chat_service.py` | Never imported by `main.py`, `api/openai.py`, `api/chat.py` | Architecture is aspirational, not implemented |
| 7 | Dead code — domain port | `app/domain/harness.py` | `HarnessPort.execute()` doesn't exist on adapters (adapters have `run()`); `ChatInput`/`ChatOutput` never used | Port/protocol not conformed |
| 8 | Stream field ignored | `app/api/chat.py` | Line 189: `if data.stream: pass` | `stream` param on MessageCreate is silently ignored |
| 9 | Unused encrypt_secret | `app/core/security.py` | `encrypt_secret`/`decrypt_secret` defined but never called anywhere | Credential profiles not implemented |
| 10 | Docker.sock mount | `docker-compose.yml` | `volumes: [/var/run/docker.sock:/var/run/docker.sock]` | Security risk in production |

---

## 8. Non-Critical Improvements

1. Add structured logging with request IDs and correlation IDs
2. Add Prometheus metrics endpoint (`/metrics`)
3. Add API versioning strategy
4. Add idempotency-key support
5. Add SSE heartbeats and event IDs for reconnect
6. Add error code enum and standardized error schema
7. Add model capability metadata (context_window, pricing)
8. Add model fallback logic
9. Add conversation pagination and search
10. Add conversation archive/soft-delete
11. Add key rotation endpoint
12. Add user self-service registration/profile
13. Add audit logging
14. Add OpenAPI spec generation (beyond auto-generated `/docs`)
15. Add field selection (compact responses)
16. Add timeout error handling (408/504)
17. Add output sanitization for harness results
18. Add self-service registration
19. Add conversation sync mechanism
20. Add mobile-friendly timeout configuration

---

## 9. Security Risks

| Risk | Location | Evidence | Severity |
|---|---|---|---|
| API key limits not enforced | `app/api/openai.py` `resolve_identity()`, `app/api/chat.py` | `APIKey` model has `daily_limit`, `monthly_limit`, `allowed_models` but these fields are never checked in any endpoint | **Critical** |
| Harness error leakage | `app/api/openai.py` line 102, `app/api/chat.py` line 201 | `str(exc)` passed directly to client — leaks stderr, internal paths, harness details | **High** |
| Debug mode stack traces | `app/core/config.py` line 12 | `debug: bool = False` — if True, FastAPI exposes stack traces | **High** |
| Weak default secrets | `app/core/config.py` lines 14-15 | `secret_key: str = "change-me-in-production"`; `credentials_key` same default | **High** |
| Docker socket mount | `docker-compose.yml` line 14 | `- /var/run/docker.sock:/var/run/docker.sock` — full container access | **High** |
| No rate limiting | `app/main.py` | No rate limiting middleware whatsoever | **Critical** |
| No output sanitization | `app/api/openai.py`, `app/api/chat.py` | Harness output (text) is passed through without sanitization; if rendered in HTML, XSS risk | **Medium** |
| JWT has no scopes | `app/core/security.py` line 19 | `jwt.encode({"sub":..., "exp":...})` — no scopes, no issuer, no audience | **Medium** |
| No session revocation | `app/api/auth.py` | Stateless JWT; no revocation list; logout only client-side | **Medium** |
| Bootstrap always available | `app/api/auth.py` line 38-44 | Bootstrap endpoint checks `if existing: 409` but is callable by anyone until first user created | **Medium** |
| CORS wildcard | `app/core/config.py` line 20 | `allowed_origins: str = "*"` — all origins accepted by default | **Medium** |
| No request body size limit | `app/main.py` | No `max_request_size` middleware; large payloads not rejected early | **Medium** |

---

## 10. Streaming Compatibility Assessment

### Current Protocol

**Transport:** Server-Sent Events (SSE), `Content-Type: text/event-stream`

**Two streaming endpoints exist:**

1. `POST /v1/chat/completions` with `"stream": true` (OpenAI-compatible)
2. `POST /api/chat/conversations/{id}/messages/stream` (dashboard chat)

**Event format (both endpoints):**

SSE lines prefixed with `data: `, then JSON payload. Events are NOT named (no `event:` field).

**Token delta event:**
```
data: {"id": "chatcmpl-xxx", "object": "chat.completion.chunk", "created": <unix_ts>, "model": "opencode//model", "choices": [{"index": 0, "delta": {"content": "some text"}, "finish_reason": null}]}

```

**Final/terminal event:**
```
data: {"id": "chatcmpl-xxx", "object": "chat.completion.chunk", "created": <unix_ts>, "model": "opencode//model", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}

data: [DONE]
```

**Error event (streaming):**
```
data: {"error": {"message": "<str(exc)>", "type": "harness_error"}}
```

### Android Compatibility

**YES** — Android can consume SSE using standard `OkHttp` client with a `EventSource` listener, or by manually parsing the `text/event-stream` body line-by-line. The SSE format is simple and standard.

**However, the protocol has critical deficiencies for a production Android client:**

1. **No event types** — All events are unnamed `data:` lines. A ChatGPT-like client would need to distinguish token deltas from tool calls from lifecycle events. Currently impossible.
2. **No heartbeats** — No SSE comments (`: keepalive`) to keep connections alive through proxies. Mobile networks frequently drop idle connections.
3. **No event IDs** — No `id:` field means no `Last-Event-ID` header for reconnect resumption. If connection drops, the client loses context.
4. **No retry directive** — No `retry:` field specifies reconnect delay.
5. **No cancellation** — Client abort (HttpRequest.cancel() on Android) does not terminate the underlying subprocess. Server-side kill endpoint does not exist.
6. **No lifecycle events** — No "stream started" or "stream completed" event with metadata (token counts, cost, duration). The completion metadata is only written to DB after the stream finishes — the client never receives it.
7. **Inconsistent error handling** — Streaming errors are yielded as data lines (`{"error":{...}}`) rather than HTTP status codes. The client must parse JSON from SSE data to detect errors.
8. **Persisting during stream** — In `/messages/stream`, the assistant message is only persisted after the full stream completes (line 301-320 in chat.py). If the stream is interrupted, the conversation history is lost. The user message IS persisted before streaming begins (line 264), but the assistant response is not.

### Recommended Improvements

1. Add named SSE events: `event: token`, `event: tool_call`, `event: metadata`, `event: error`, `event: done`
2. Add `: keepalive` heartbeat every 15-30 seconds
3. Add `id:` field with completion_id for reconnect via `Last-Event-ID`
4. Add `retry: 5000` directive
5. Add cancellation endpoint: `POST /v1/chat/completions/{id}/cancel` or DELETE on stream
6. Add a `metadata` event with token counts, cost, duration
7. Standardize error: always use `{"error": {"code": "harness_error", "message": "..."}}` with HTTP status where possible

---

## 11. GPT/Assistant Architecture Assessment

### Current Architecture

There is **no assistant system** in the codebase. No `assistants` table, no endpoints, no model, no concept.

The closest the system gets is per-conversation `model` selection, where the model identifier (`harness//model`) implicitly selects the harness and model. There is no concept of named assistants with instructions, tools, or files.

**Evidence of absence:**
- `app/db/database.py` — No `Assistant` model in the SQLAlchemy schema (only User, APIKey, Harness, Conversation, Message, UsageRecord).
- `app/api/admin.py` — No assistant endpoints.
- `app/api/chat.py` — No assistant references.
- `app/api/openai.py` — `ChatRequest` has no `assistant` field.
- `app/domain/harness.py` — No assistant domain model.
- `app/application/chat_service.py` — `ChatService` has no assistant concept.

### Can It Be Added?

**Yes, the architecture can accommodate assistants**, but it requires significant new work:

1. **Database:** Add `assistants` table with columns: `id`, `user_id`, `name`, `description`, `avatar`, `instructions`, `model`, `tools` (JSON), `files` (JSON/array of file IDs), `created_at`, `updated_at`, `is_active`.

2. **API:** Add endpoints:
   - `POST /api/chat/assistants` — create
   - `GET /api/chat/assistants` — list
   - `GET /api/chat/assistants/{id}` — get
   - `PATCH /api/chat/assistants/{id}` — update
   - `DELETE /api/chat/assistants/{id}` — delete
   - `POST /api/chat/conversations/{id}/messages` — add `assistant_id` to select assistant

3. **Chat execution:** When `assistant_id` is provided, inject `assistant.instructions` as a system message and filter allowed tools.

4. **File association:** Assistants can reference uploaded files (requires file upload feature first).

### Best Architecture Given Current Code

Given the existing codebase, the most natural approach is to extend the **Chat API** (`/api/chat/`) rather than the OpenAI-compatible API (`/v1/`), since the chat API already has conversation persistence:

```
POST /api/chat/assistants
  → {name, description, model, instructions, tools, file_ids}

GET /api/chat/assistants
  → [{id, name, description, model, tools, file_count, created_at, updated_at}]

GET /api/chat/assistants/{id}
  → {id, name, description, model, instructions, tools, files, created_at, updated_at}

PATCH /api/chat/assistants/{id}
  → {name, description, model, instructions, tools, file_ids}

POST /api/chat/conversations/{id}/messages
  → body: {content, model?, assistant_id?, stream?}
  → When assistant_id provided: inject system instructions, apply tool config
```

This fits the existing architecture: the `MessageCreate` schema already accepts `model`, and `send_message`/`stream_message` already resolve the model and build the conversation history. Adding `assistant_id` to `MessageCreate` would let the server inject system instructions from the assistant.

### Recommendation

The assistant concept **cannot** be built without first implementing file uploads and system instructions. The architecture supports adding it (SQLAlchemy models are straightforward, chat endpoints accept model overrides), but it is **not present** and requires 3-4 new endpoints + DB table + integration into the chat execution flow.

---

## 12. Model/Harness Abstraction Assessment

### Current Abstraction

The Gateway defines a `HarnessAdapter` ABC (`app/harnesses/registry.py` line 29) with these methods:

- `is_installed()` — checks executable on PATH
- `install()` — runs npm install (yields progress, but endpoint is stub)
- `update()` — runs npm update
- `authenticate()` — returns static "manual_required" stub
- `list_models()` — harness-specific discovery
- `build_command()` — ABSTRACT, per-harness implementation
- `parse_line()` — per-line streaming parse (default: passthrough)
- `parse_output()` — full output parse (default: decode+strip)
- `run()` — synchronous execution with timeout
- `stream()` — async line-by-line streaming

**Four concrete adapters:**
1. `ClaudeAdapter` — `claude` (Claude Code)
2. `CodexAdapter` — `codex` (OpenAI Codex CLI)
3. `OpenCodeAdapter` — `opencode` (OpenCode)
4. `CommandCodeAdapter` — `cmd` (Command Code)
5. `GenericAdapter` — configurable with `command_template` using `{prompt}` and `{model}` placeholders

### Abstraction Quality

**Good aspects:**
- The base `HarnessAdapter` provides default `run()` and `stream()` implementations that work with any command built by `build_command()`.
- `parse_line()` and `parse_output()` allow per-harness output normalization.
- `build_command()` is abstract, forcing each adapter to define its CLI invocation.
- The `GenericAdapter` allows adding new harnesses without subclassing.

**Provider-specific leakage:**
- `build_command()` accepts `session_id` but the API endpoints never pass it — `split_model()` in `openai.py` and `chat.py` never provides `session_id` to `adapter.run()` or `adapter.stream()`. This means `--resume`/`--session` flags are never set.
- The Claude adapter uses `--output-format stream-json` which produces JSON objects per line — `parse_line()` handles this.
- The Codex adapter uses `--json` which produces JSON — `parse_line()` handles this.
- The OpenCode adapter uses `--format json` and `parse_output()` joins parsed lines.
- The Command Code adapter uses `--output-format json` and handles `event`, `type`, `finalText` fields.
- **No tool call parsing** in any adapter — all adapters only extract text content.
- **No token counting** from harness metadata — `HarnessResult` has `prompt_tokens`/`completion_tokens` but they are always 0 (the adapters' `run()` method never populates them; `parse_output()` only returns text).

### Model ID Format

The model identifier format is `harness//model` (e.g., `opencode//opencode/big-pickle`). The `split_model()` function splits on `/` with maxsplit=2:
- `opencode//opencode/big-pickle` → `("opencode", "opencode/big-pickle")`
- `codex//gpt-5` → `("codex", "gpt-5")`

This works but is inconsistent: OpenCode models contain `/` in the model name (provider/model), while Codex and Claude models are simple names. The `owned_by` field in `/v1/models` is set to `model.harness` (the harness name), not the provider.

### HarnessResult Token Counts

Critical: `HarnessResult` has `prompt_tokens`, `completion_tokens`, `cached_tokens` fields, but **no adapter ever populates them**. In `openai.py` line 108:
```python
usage = {"prompt_tokens": result.prompt_tokens or len(prompt.split()), ...}
```
The `or len(prompt.split())` fallback means token counts are always word-count approximations, never actual token counts from the harness.

### Assessment

The abstraction **partially succeeds** at hiding harness differences for basic text streaming, but:
- No tool calling abstraction
- No system instruction abstraction
- No model capability metadata
- No real token counting
- No unified error handling (each adapter has different error formats)
- No credential profile injection (env vars only, `authenticate()` is a stub)
- The `ChatService` and `HarnessPort` domain port/protocol are **not connected** to the actual adapters — dead code that suggests an intended abstraction layer that was never completed.

**Verdict:** The harness abstraction is functional for text-only chat but does not abstract provider-specific capabilities. Afaq One would need to handle tool calls, system instructions, and file attachments as harness-specific features, with no unified interface.

---

## 13. Mobile API Compatibility Assessment

| Aspect | Current State | Mobile Impact |
|---|---|---|
| **JSON stability** | Implicit schemas, no OpenAPI contract | High risk of breaking changes without notice |
| **Pagination** | None — conversation list returns all | Mobile app with many conversations will have slow loads and high memory use |
| **Idempotency** | No idempotency key support | Retry after network loss may create duplicate conversations/messages |
| **Stream resumption** | No event IDs, no retry directive | Mobile network drops cause loss of partial responses; client must restart from scratch |
| **Timeouts** | 600s harness timeout | Too long for mobile; requests will appear to hang during network issues or long generation |
| **Error predictability** | Inconsistent (FastAPI default vs custom streaming) | Client must handle multiple error formats; fragile |
| **Compact responses** | All fields always returned | Extra bandwidth on mobile networks |
| **Versioning** | Only `/v1` prefix, no strategy | No path for breaking changes without disruption |
| **SSE on mobile** | Standard SSE (text/event-stream) | OK on iOS 13+/Android; but no heartbeats means connections drop during network switches |

---

## 14. Recommended API Contract

### Base URL
```
https://gateway.example.com
```

### Authentication
- Dashboard: JWT via `POST /api/auth/login` → `Authorization: Bearer <jwt>`
- External/API: API key via `POST /api/admin/keys` → `Authorization: Bearer <afaq_xxx>`
- All `/api/*` endpoints require JWT
- All `/v1/*` endpoints accept JWT or API key

### Versioning Strategy
- URL versioning: `/api/v2/...`, `/v1/...`
- Deprecation headers: `X-API-Deprecation: version=v1; deprecated_at=...`
- Version discovery: `GET /api/version`

### Error Schema (Unified)
```json
{
  "error": {
    "code": "string_enum",
    "message": "human-readable string",
    "type": "category",
    "param": "field_name_or_null",
    "retryable": true
  }
}
```

### Streaming Protocol (SSE)
```
event: session
data: {"id": "sess_abc", "conversation_id": 123}

event: metadata
data: {"model": "opencode//model", "created": 1234567890}

event: content_delta
data: {"content": "chunk text"}

event: tool_call
data: {"tool_call_id": "tc_1", "name": "function_name", "arguments": "..."}

event: tool_output
data: {"tool_call_id": "tc_1", "output": "...", "error": null}

event: usage
data: {"prompt_tokens": 10, "completion_tokens": 20}

event: error
data: {"error": {"code": "harness_error", "message": "...", "retryable": true}}

event: done
data: [DONE]
```

With `id:` field on each event, `retry: 30000` directive, and `: keepalive` heartbeat every 20s.

### Conversation Endpoints (v2)
```
GET    /api/v2/conversations?limit=50&offset=0&sort=updated_at&archived=false
POST   /api/v2/conversations
GET    /api/v2/conversations/{id}
PATCH  /api/v2/conversations/{id}
DELETE /api/v2/conversations/{id}
POST   /api/v2/conversations/{id}/archive
POST   /api/v2/conversations/{id}/restore
GET    /api/v2/conversations/{id}/messages?limit=50&offset=0
```

### Message Endpoints (v2)
```
POST   /api/v2/conversations/{id}/messages       (non-streaming, idempotent via Idempotency-Key)
POST   /api/v2/conversations/{id}/messages/stream (SSE streaming)
POST   /api/v2/conversations/{id}/messages/{msg_id}/regenerate
POST   /api/v2/conversations/{id}/messages/{msg_id}/retry
PATCH  /api/v2/conversations/{id}/messages/{msg_id} (edit)
POST   /api/v2/conversations/{id}/messages/cancel  (stop generation)
```

### File Endpoints (v2)
```
POST   /api/v2/files                    (multipart upload, MIME validation)
GET    /api/v2/files/{id}               (download/metadata)
DELETE /api/v2/files/{id}               (delete)
GET    /api/v2/files/{id}/content       (download binary)
```

### Assistant Endpoints (v2)
```
POST   /api/v2/assistants               (create)
GET    /api/v2/assistants               (list)
GET    /api/v2/assistants/{id}          (get)
PATCH  /api/v2/assistants/{id}          (update)
DELETE /api/v2/assistants/{id}          (delete)
```

### Tool Endpoints (v2)
```
POST   /api/v2/conversations/{id}/tools/execute   (execute tool, approval flow)
GET    /api/v2/conversations/{id}/tools           (list tool executions)
```

### Usage Endpoints (v2)
```
GET    /api/v2/usage                  (?start=&end=&harness=&model=)
GET    /api/v2/keys/{id}/usage        (?start=&end=)
```

### Harness Endpoints (v2)
```
GET    /api/v2/harnesses              (list with capabilities)
GET    /api/v2/harnesses/{name}       (detail + health)
POST   /api/v2/harnesses/{name}/install (job-based, returns job_id)
GET    /api/v2/harnesses/{name}/install/jobs/{job_id} (status)
POST   /api/v2/harnesses/{name}/refresh (refresh models)
```

### Health Endpoints (v2)
```
GET    /api/v2/health                 (gateway health)
GET    /api/v2/health/harnesses       (per-harness health)
```

---

## 15. Recommended Architecture Changes

### 1. Complete the Domain/Adapter Bridge
The `ChatService` in `app/application/chat_service.py` and `HarnessPort` protocol in `app/domain/harness.py` are dead code. Either:
- **Option A:** Wire `ChatService` into the API endpoints, making adapters conform to the `HarnessPort` protocol (rename `run()` → `execute()`).
- **Option B:** Remove the dead code to avoid confusion.

**Recommended:** Option A — refactor adapters to implement `HarnessPort` protocol and route all API calls through `ChatService`.

### 2. Add a Job/Queue Layer
The current architecture spawns subprocesses directly with no queue. Add a job queue (SQLite-based or Redis-based) to:
- Track long-running harness processes
- Support cancellation (track PID, send SIGTERM on cancel)
- Support retry (requeue failed jobs)
- Enforce rate limits per API key/user
- Queue requests when harness is busy

### 3. Add a Middleware Layer
Add standard middleware:
- Request ID generation (`X-Request-ID`, `X-Correlation-ID`)
- Structured logging with request IDs
- Rate limiting (in-memory for single-node, Redis for distributed)
- Request body size limits
- Error sanitization (strip internal details from error messages)

### 4. Add a File Storage Layer
Use the existing `uploads_dir` config to implement:
- File upload with MIME validation and size limits
- File metadata in SQLite
- File lifecycle (retention, cleanup)
- Image extraction/preview

### 5. Add a Tool Execution Layer
Extend `HarnessAdapter` with:
- `parse_tool_calls()` — extract tool call JSON from harness output
- `execute_tool()` — run a tool and return result
- Tool approval workflow
- SSE tool event emission

### 6. Add an Assistant Domain Model
Add SQLAlchemy models:
- `Assistant` (id, user_id, name, description, avatar, instructions, model, tools, file_ids, timestamps)
- Integrate into message flow: inject system instructions, apply tool config

### 7. Add Test Infrastructure
- pytest with pytest-asyncio
- httpx.AsyncClient for endpoint testing
- Fixtures for database isolation
- Mock harness adapters

### 8. Add Observability
- Structured JSON logging
- Prometheus metrics endpoint
- Health check per harness
- Audit log table

### 9. Security Hardening
- Enforce `daily_limit`/`monthly_limit`/`allowed_models` per API key
- Add rate limiting (per key, per user, per IP)
- Sanitize error messages
- Remove Docker socket mount from compose
- Add request body size limits

---

## 16. Implementation Phases Required Before Building Afaq One

### Phase 0: Foundation (Immediate — blocks everything)
1. **Fix dead code** — Either wire `ChatService`/`HarnessPort` into endpoints or remove them.
2. **Add test infrastructure** — pytest, fixtures, basic endpoint tests.
3. **Fix streaming bug** — `MessageCreate.stream` field is ignored; make `POST /messages` honor it or remove the field.
4. **Security hardening** — Enforce per-key limits, sanitize errors, remove docker.sock mount.

### Phase 1: ChatGPT Core (Required for MVP)
5. **Cancel/stop endpoint** — Server-side process termination on client disconnect.
6. **SSE protocol improvement** — Add event types, heartbeats, event IDs, retry directive.
7. **File upload** — Multipart upload, MIME validation, size limits, storage.
8. **Image input** — Accept image URLs/content in messages, pass to harness.
9. **System instructions** — Accept system role in messages, or per-conversation system prompt.
10. **Usage API** — `GET /api/v2/usage` endpoint for usage history.

### Phase 2: Agent Capabilities (Required for ChatGPT Plus)
11. **Tool/function calling** — Tool schema in request, tool call parsing in adapters, SSE tool events, approval flow.
12. **Retry/regenerate** — Endpoints to retry or regenerate messages.
13. **Edit user message** — PATCH on messages to edit and regenerate.
14. **Model fallback** — Automatic retry on alternate model/harness on failure.
15. **Structured output** — `response_format` parameter support.

### Phase 3: Assistants (Required for Custom GPTs)
16. **Assistant CRUD** — Full CRUD API for assistants.
17. **Assistant invocation** — `POST /conversations/{id}/messages` with `assistant_id`.
18. **Assistant conversation context** — Persist assistant context per conversation.

### Phase 4: Production Hardening (Required for scale)
19. **Rate limiting** — Per-key, per-user, per-IP rate limiting.
20. **Queue & backpressure** — Job queue with cancellation support.
21. **Observability** — Structured logging, metrics, per-harness health checks.
22. **Pagination** — Conversation list, message list pagination.
23. **API versioning** — Formal versioning strategy with deprecation policy.
24. **Audit logging** — Audit trail of all admin/user actions.
25. **Horizontal scaling** — Move from SQLite to PostgreSQL, shared cache for models.

---

## 17. Build Classification

| Feature Area | Classification |
|---|---|
| Basic text chat (send/receive) | **Build Now** |
| Streaming responses | **Build Now** (protocol improvements needed) |
| Conversation list/rename/delete | **Build Now** |
| Model selection | **Build Now** |
| Health check | **Build Now** |
| **Stop/cancel generation** | **Must Fix First** |
| **Rate limiting** | **Must Fix First** |
| **Per-key limit enforcement** | **Must Fix First** |
| **File upload / image input** | **Must Fix First** |
| **Tool/function calling** | **Must Fix First** |
| **System instructions** | **Must Fix First** |
| **Custom assistants** | **Build Later** |
| **Usage history API** | **Build Later** |
| **Conversation archive** | **Build Later** |
| **Conversation pagination** | **Build Later** |
| **Retry / regenerate / edit message** | **Build Later** |
| **Structured output (JSON mode)** | **Build Later** |
| **API versioning** | **Build Later** |
| **SSE heartbeats / reconnect** | **Build Later** |
| **Metrics / Prometheus** | **Build Later** |
| **Structured logging / tracing** | **Build Later** |
| **Key rotation** | **Build Later** |
| **Session management / revocation** | **Build Later** |
| **Authorization scopes** | **Build Later** |
| **Audit logging** | **Build Later** |
| **Harness installation workflow** | **Build Later** |
| **Harness health checks** | **Build Later** |
| **Model capability metadata** | **Build Later** |
| **Model fallback** | **Build Later** |

---

## Answer

**PARTIALLY**

The Afaq Harness Gateway is **partially sufficient** to serve as the backend/API foundation for Afaq One. It provides a working ChatGPT-like chat experience with conversation history, streaming responses, model selection, conversation management (list/rename/delete), JWT authentication, and hashed API keys. However, it has severe gaps that prevent a production-quality ChatGPT-class experience:

1. **No file upload or image input** — a blocker for ChatGPT-class UX.
2. **No stop/cancel generation** — no server-side process cancellation; the 600s timeout means killed requests leave orphaned subprocesses.
3. **No tool/function calling** — no tool schema in the request, no tool event parsing, no SSE tool events. Critical for agentic workflows.
4. **No rate limiting** — `daily_limit`, `monthly_limit`, and `allowed_models` fields exist on APIKey but are **never enforced** in any endpoint.
5. **No custom assistants** — no assistants table, no CRUD, no system instructions, no assistant-scoped tooling.
6. **No retry/regenerate/edit message** — the frontend "retry" button shows "coming soon"; no backend endpoints exist.
7. **No usage history API** — `usage_records` table exists but there is no GET endpoint to query it.
8. **No tests** — the `tests/` directory is empty; the README explicitly states no test runner is configured.
9. **Dead code** — `ChatService` and `HarnessPort` in `app/application/` and `app/domain/` are never imported by any endpoint. The `stream` field on `MessageCreate` is accepted but silently ignored (`if data.stream: pass`). `encrypt_secret`/`decrypt_secret` functions exist but are never called.
10. **Streaming protocol is incomplete** — no event types (only unnamed `data:` lines), no heartbeats, no event IDs, no `retry` directive, no reconnect/resume capability.
11. **No observability** — no structured logging, no request IDs, no metrics, no audit logging.
12. **Security risks** — error messages leak harness internals (stderr), weak default secrets, docker.sock mounted in compose, no output sanitization.
13. **Mobile API gaps** — no pagination, no idempotency, no stream resumption, 600s timeout too long for mobile.
14. **Single-node SQLite** — no horizontal scaling, no connection pooling, no graceful shutdown of in-flight processes.

**What prevents a YES:** The absence of file upload, image input, tool calling, cancel/stop, rate limiting, usage API, and tests are all **critical blockers** that make the current Gateway insufficient as a complete backend for a production ChatGPT-class Android application. The architectural foundation (FastAPI + adapters + SQLite) is workable, but significant implementation is required across security, streaming protocol, file handling, agent capabilities, and production hardening before Afaq One can be built entirely on top of it.
