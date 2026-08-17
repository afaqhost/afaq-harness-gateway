# Hermes Integration

Hermes is a client of Afaq Harness Gateway, not the gateway itself.

Expected configuration:

```text
Provider: Custom OpenAI-compatible endpoint
Base URL: http://afaq-harness-gateway:8787/v1
API Key: <Hermes-specific key>
Model: <supported Afaq model ID>
```

## Verification order

1. `/health`.
2. `/v1/models` with the Hermes key.
3. non-streaming Chat Completion.
4. streaming Chat Completion.
5. dashboard request.
6. Telegram path if used.
7. usage isolation by Hermes API key.

Keep Hermes-specific assumptions out of the core runtime.
