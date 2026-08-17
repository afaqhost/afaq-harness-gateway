# Streaming and Chat

## Streaming contract

When `stream=true`, return OpenAI-compatible SSE chunks followed by `[DONE]`.

The adapter event stream is converted to transport events by the service layer.

## Chat UI

The internal Chat UI must support:

- conversation list;
- new conversation;
- harness/model selection;
- message rendering;
- streaming assistant output;
- stop/cancel;
- run metadata;
- editable conversation title.

The UI must not contain CLI process logic. It uses the same backend service as the API.

## Context handling

Persist messages in the database. Native harness session IDs are optional and must not be the only source of Chat memory.
