# Release Notes

## v0.1.0 -- First public release

This is the initial public release of Afaq Harness Gateway.

### What it is

Afaq Harness Gateway is a self-hosted, single-node gateway that exposes an
OpenAI-compatible API over four local AI coding assistant CLIs ("harnesses"):
command-code, codex, claude-code, and opencode. It lets you route chat
completion requests to any of these tools through a single endpoint with
authentication, usage tracking, and cost estimation.

### What is included

- OpenAI-compatible `/v1/chat/completions` endpoint (streaming and
  non-streaming).
- Four built-in adapter integrations with normalized event output.
- API-key authentication with per-key rate limits, budgets, and model
  allowlists.
- Session-based admin auth for key management.
- Usage and estimated cost tracking.
- Conversation history with SQLite persistence.
- Docker support.
- Web UI for interactive chat.

### Known limitations

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for the full list. Key
items:

- No built-in TLS termination.
- SQLite is the only store (single-node, no clustering).
- In-process queue only (no Redis or PostgreSQL).
- Usage costs are estimated, not billed.
- Adapter CLI contracts can drift between CLI versions.

### Security

See [SECURITY.md](../SECURITY.md) for the security policy and reporting
instructions. The threat model is documented in
`09-hardening/03_THREAT_MODEL.md` and `docs/SECURITY_MODEL.md`.

The gateway has no built-in TLS. Deploy behind a reverse proxy, VPN, or
tunnel. The process boundary between the gateway and each Harness CLI is the
trust boundary.

### Licensing

Afaq Harness Gateway is released under the Apache License 2.0. See
[LICENSE](../LICENSE).

The four Harness CLIs are external tools developed and licensed by their
respective vendors. Afaq's Apache-2.0 license does not grant any rights to
third-party Harness services, provider subscriptions, or associated accounts.
You are responsible for complying with each CLI's own license terms.
