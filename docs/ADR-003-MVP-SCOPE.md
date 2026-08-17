# ADR-003 — MVP Scope

## Decision

MVP is a self-hosted single-node gateway for a small team.

Included:

- OpenAI-compatible API;
- one or more internal API keys;
- SQLite;
- in-process queue;
- one production adapter (Command-Code);
- streaming;
- usage/cost estimates;
- basic admin and Chat UI;
- Hermes integration.

Excluded until justified:

- public SaaS billing;
- Kubernetes;
- distributed workers;
- multi-region HA;
- workspace/file-management Chat;
- public marketplace.
