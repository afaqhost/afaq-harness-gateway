# Phase 14 — Managed Deployment & Tenant Isolation

## Objective

Prepare an optional managed-hosting layer where each customer receives an isolated Afaq deployment and uses their own Harness accounts.

This phase is deployment/infrastructure, not third-party subscription resale.

## Target model

```text
Afaq Host
    ↓
Tenant
    ↓
Dedicated Container / Deployment
    ↓
Afaq Harness Gateway
    ├── Customer Command Code account
    ├── Customer Claude Code account
    ├── Customer Codex account
    └── Customer OpenCode account
```

The customer supplies and controls the third-party accounts/credentials required for the Harnesses they choose.

## Scope

Provide foundations for:

- tenant identity
- per-tenant database
- per-tenant volumes
- per-tenant Harness configuration
- per-tenant credentials/config boundary
- CPU/memory/storage limits
- process/run concurrency
- queue limits
- deployment health checks
- backup boundaries
- lifecycle operations

## Isolation requirements

Each tenant must be isolated for:

- database
- Harness configuration
- sessions
- logs
- artifacts
- credentials/config files
- runtime processes

Do not expose the host Docker socket to a tenant.

A tenant must not be able to:

- access another tenant's filesystem
- read another tenant's credentials
- signal another tenant's processes
- access another tenant's environment
- escape its intended execution boundary

## Commercial boundary

Afaq Host sells hosting and management of the Afaq software.

It must not assume the right to resell a third-party Harness subscription.

Provider-specific terms must be reviewed before offering a commercial deployment for a particular Harness.

## Acceptance criteria

- Tenant boundaries are documented.
- Per-tenant storage/config is isolated.
- Resource limits are enforced.
- Tenant lifecycle is defined.
- Host secrets are not exposed.
- Customer-owned Harness accounts can be configured.
- Security tests cover tenant isolation.
