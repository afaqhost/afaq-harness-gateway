# Test Strategy

## Unit tests

Test pure logic:

- model resolution;
- aliases;
- request validation;
- prompt/message serialization;
- JSONL parsers;
- SSE formatting;
- cost calculation;
- API-key hashing/verification.

## Contract tests

Every adapter must pass the same normalized event contract suite.

## Integration tests

Use a fake harness executable to test:

```text
fake harness -> adapter -> service -> API -> OpenAI response
```

## End-to-end tests

Use a real harness only in opt-in local smoke tests. Never make paid credentials a CI requirement.

## Security tests

Cover shell injection, unauthorized model use, revoked keys, request limits, oversized input, log redaction, and process cleanup.
