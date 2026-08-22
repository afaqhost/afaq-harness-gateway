# Tenant Module

Per-tenant isolation, storage, configuration, process management, health checks, and backup boundaries for the Afaq Harness Gateway.

## Tenant Model

A **Tenant** (`types.ts`) represents a single customer with:

- `id` — unique identifier
- `name` — display name
- `rootDir` — absolute path on the host filesystem (never contains `..`, always absolute, normalized)
- `state` — lifecycle: `provisioning` → `active` → `suspended` → `removed`
- `limits` — optional CPU, memory, storage, concurrency, and queue capacity constraints

### Lifecycle States

```
provisioning ──activate──▶ active ──suspend──▶ suspended
     │                       │                    │
     └──remove──▶ removed ◀──┘        resume──▶ active
                                    └──remove──▶ removed
```

`removed` is terminal — no transitions out.

## Per-Tenant Storage Layout

Each tenant gets an isolated directory tree under its `rootDir`:

```
<rootDir>/
  data/           # runtime data
    tenant.db     # per-tenant SQLite key-value store
  config/         # Harness configuration
  credentials/    # opaque credential references (never raw secrets)
  logs/           # execution logs
  artifacts/      # build artifacts, temp files (also used as TMPDIR)
```

`ensureTenantStorage()` creates all directories idempotently. `openTenantStore()` opens (or creates) the SQLite database with WAL mode, foreign keys, and 5s busy timeout.

## Per-Tenant Harness Configuration

`TenantConfigStore` holds per-tenant Harness definition configs as in-memory shallow copies. `TenantConfigRegistry` enforces cross-tenant isolation — a tenant can only access its own configs. Configs contain definition IDs and opaque settings; **no raw credentials are stored here** — only credential references that resolve through `TenantSecretStore`.

## Credential Boundary

- **Opaque refs only**: `TenantSecretStore` prefixes all secret refs with `tenant:<tenantId>:`, preventing cross-tenant access.
- **Env stripping**: `buildTenantEnv()` removes all host-sensitive env vars (Docker socket, cloud credentials, API keys, KUBECONFIG, AHG_ prefixed vars) and sets `HOME`/`TMPDIR` to tenant-scoped paths.
- **No raw secrets in config**: Harness configs reference credentials by ref, never by material.

## Resource Limits

Enforced by `TenantResourceGuard`:

| Limit | Field | Description |
|-------|-------|-------------|
| CPU | `cpuQuota` | Max CPU units per run |
| Memory | `memoryBytes` | Max memory per run |
| Storage | `storageBytes` | Max disk usage |
| Concurrency | `maxConcurrentRuns` | Max parallel executions |
| Queue | `queueCapacity` | Max pending tasks |

`TenantQueue` wraps a `TaskQueue` with tenant-scoped concurrency and capacity.

## Process Isolation

`buildTenantSpawnOptions()` produces spawn options that enforce:

- `shell: false` — no shell injection
- `detached: true` — isolated process group
- `cwd` set to tenant `data/` directory
- `env` built by `buildTenantEnv()` — no host Docker socket, no host filesystem mounts, no host-sensitive env vars
- `HOME` and `TMPDIR` scoped to tenant root

`assertTenantSpawnOptions()` validates these invariants and throws `TenantProcessIsolationError` on violation.

## Health Checks

`TenantHealthService.check()` returns a structured `TenantHealth` result (never throws for check failures):

- **Storage**: all tenant directories exist on disk
- **Database path**: within tenant root (containment check)
- **Isolation policy**: `DEFAULT_ISOLATION_POLICY` passes (no Docker socket exposure, no host filesystem mount)
- **Env safety**: tenant env contains no host-sensitive keys

## Backup Boundaries

`createBackupBoundary()` defines what can be backed up:

- **Included**: `data/`, `config/`, `credentials/`, `logs/`, `artifacts/`
- **Excluded (host-safety)**: `/var/run/docker.sock`, `/etc`, `/proc`, `/sys`, `/run`, `/boot`

`assertPathWithinBackupBoundary()` rejects host-excluded paths and paths outside the tenant root. `isHostExcludedPath()` checks the fixed host-exclusion list.

## Commercial Boundary

Afaq Host sells **hosting and management of the Afaq Harness Gateway software only**. The customer supplies and controls their own third-party Harness accounts and credentials. Afaq Host does not resell third-party subscriptions. Provider-specific terms of service must be reviewed before offering a commercial deployment to any customer.
