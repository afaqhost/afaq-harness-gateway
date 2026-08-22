# Known Limitations

This document lists the known limitations of Afaq Harness Gateway as of
v0.1.0.

## Infrastructure

| Limitation | Details |
|---|---|
| No built-in TLS | The gateway listens on plain HTTP. Deploy behind a reverse proxy, Cloudflare Tunnel + Access, Tailscale, or similar. |
| SQLite only | All persistence (runs, auth, chat) uses SQLite with WAL mode. Single-node only; no clustering or replication. |
| In-process queue | The run queue is in-process. There is no Redis, PostgreSQL, or external message broker. |
| Single-node | No built-in horizontal scaling, load balancing, or multi-region support. |

## Harness CLIs

| Limitation | Details |
|---|---|
| No auto-install | The gateway does not automatically install the four Harness CLIs. They must be installed and authenticated separately. |
| CLI contract drift | CLI output schemas, event formats, and flags can change between versions. The gateway's adapter normalization may lag behind CLI changes. |
| External licensing | The four CLIs are third-party tools under their vendors' terms. Afaq's license does not grant rights to these services. |

## Usage and billing

| Limitation | Details |
|---|---|
| Estimated costs only | Usage costs reported by the gateway are estimates based on token counts and configured pricing. They are not billed amounts. |
| No billing integration | There is no built-in billing, invoicing, or payment processing. |
| No marketplace | No subscription resale or marketplace functionality. |

## Deployment

| Limitation | Details |
|---|---|
| No Kubernetes support | No Helm charts, operators, or container-orchestration specifics are provided. |
| No multi-tenant isolation | The open-source core is single-tenant. Managed multi-tenant deployment guidance is in `docs/phases/14-managed-deployment/` but is not part of the core. |
| No subscription resale | No built-in support for reselling access to third-party Harness provider subscriptions. |

## Testing

| Limitation | Details |
|---|---|
| Opt-in smoke tests | Real-harness smoke tests (tests that invoke actual CLI binaries) are opt-in and not part of the default test suite. |
| Mock-based testing | The default test suite uses mocks and fixtures rather than live CLI invocations. |
