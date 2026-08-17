# Roadmap

## MVP success criteria

The MVP is complete when:

- API keys can be created and securely stored as hashes.
- `/health` works.
- `/v1/models` is authenticated and returns allowed models.
- `/v1/chat/completions` works for non-streaming requests.
- `stream=true` returns OpenAI-compatible SSE.
- Command-Code can be started headlessly inside the runtime environment.
- Command-Code output is normalized through `HarnessAdapter`.
- Runs are persisted with status, duration, and usage when available.
- A basic Chat UI uses the same backend service layer as the API.
- Hermes can use the gateway as a custom OpenAI-compatible provider.
- Secrets are not exposed in logs or UI.
- Disabled keys and disallowed models are rejected before process execution.

## Post-MVP

- More adapters.
- Better session continuation.
- Distributed workers only when measured demand requires them.
- Optional PostgreSQL/Redis migrations.
- Advanced team/enterprise capabilities.

## Non-goals for MVP

No public SaaS billing, no marketplace, no Kubernetes, no multi-region HA, and no workspace/file-management Chat UI.
