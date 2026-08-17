# Security Model

Treat every client request and every model response as untrusted input.

Primary threats:

- shell/argument injection;
- stolen API keys;
- harness account leakage;
- prompt injection;
- excessive concurrency/cost;
- sensitive data in logs;
- insecure network exposure.

Controls are enforced in layers: transport auth, authorization, request validation, model allowlists, safe process execution, bounded concurrency, secret isolation, and network protection.
