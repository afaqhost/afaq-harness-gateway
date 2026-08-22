# Agent Addendum — Phase 10 to Release

This supplements the permanent `AGENT_HANDOFF.md`.

## Platform rules

The platform must support:

- multiple Harnesses
- independent installations
- multiple credential profiles where supported
- structured capabilities
- deterministic lifecycle state
- safe installation/discovery
- version compatibility
- optional managed per-tenant deployment

## Do not introduce

- Hermes-specific logic into generic runtime code
- Command-Code as an assumed universal/default Harness
- shared writable Harness config between tenants
- raw credentials in normal logs or API responses
- arbitrary shell commands from untrusted Harness definitions
- third-party subscription resale

## Compatibility baseline

Protect the existing:

- OpenAI-compatible API
- streaming
- cancellation
- model routing
- Adapter contract
- ProcessRunner security
- API-key enforcement
- usage tracking
- Hermes integration
- four-Harness contract coverage

## Delegation

Use `cmd-delegate` for routine implementation.

Default implementation model:

```text
xiaomi/mimo-v2.5-pro
```

Lead/reviewer model:

```text
deepseek/deepseek-v4-pro
```

Delegated implementers do not commit.
