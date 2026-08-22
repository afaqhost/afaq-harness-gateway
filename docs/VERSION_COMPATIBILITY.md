# Version Compatibility & Safe Updates

This document describes the version compatibility and safe update system implemented in `src/updates/`.

## Installed Version Tracking

The `VersionStateStore` persists one row per harness definition, tracking:

- **installedVersion** — the currently installed version
- **latestKnownVersion** — the newest version known to the system
- **compatibilityStatus** — `"supported"`, `"incompatible"`, or `"unknown"`
- **knownGoodVersion** — the last version that passed all update gates
- **notes** — free-form compatibility notes
- **checkedAt** — timestamp of the last state change

The store uses SQLite (`node:sqlite` `DatabaseSync`) with WAL mode, foreign keys, and busy timeout, mirroring the pattern in `src/install/store.ts`.

## Supported Version Ranges

A `VersionRange` defines compatibility constraints:

- **minimum** — inclusive lower bound (semver comparison)
- **maximum** — inclusive upper bound (semver comparison)
- **allowed** — explicit allowlist; if non-empty, only listed versions pass
- **blocked** — known-bad versions; checked first and always rejected
- **notes** — informational notes carried through to results

Evaluation order: blocked → allowed → minimum → maximum → supported.

## Compatibility Statuses

| Status | Meaning |
|---|---|
| `supported` | Version passes all range checks |
| `incompatible` | Version fails one or more range checks |
| `unknown` | No range was provided; compatibility cannot be determined |

## Update Availability

`UpdateService.checkForUpdate()` compares the installed version against the latest known version. An update is available only when `latestKnownVersion` is defined and is strictly newer (by semver comparison) than the installed version. This method is read-only — it never installs or activates anything.

## Safe Update Flow

`UpdateService.performUpdate()` executes an ordered gate sequence:

1. **Load state** — requires an existing installed version in the store
2. **Resolve target** — explicit `targetVersion` or latest known version
3. **Compatibility check** — rejects before installing if target is not `"supported"`
4. **Install** — calls the injected `installOrUpdate` function
5. **Version verification** — runs the version command via `detectVersion()` and confirms the output matches the target version exactly
6. **Adapter contract test** — runs `runAdapterContractTest()` against the adapter
7. **Post-update health check** — calls `adapter.health()` one final time
8. **Activation** — only after all gates pass: persists the new state with `knownGoodVersion` set to the target

If any gate fails, the update is rejected. The installed version and known-good version are preserved. No partial state is committed.

## Version Verification

After installation, the system runs the harness's version command (e.g., `["my-harness", "--version"]`) using `detectVersion()` from `src/install/version.ts`. The detected version must exactly match the target version. A mismatch causes rejection.

## Adapter Contract Testing

During update validation, `runAdapterContractTest()` verifies the adapter's contract:

1. `adapter.health()` must return `{ ok: true }`
2. `adapter.listModels()` must return a non-empty list
3. A test run with a simple "Hello" message must emit events in the correct sequence: `started` → `text_delta` → `completed` (exactly one), with no `failed` events

## Post-Update Health Check

After the contract test passes, `adapter.health()` is called again as a final gate. This ensures the adapter remains healthy after the update process.

## Safe Rejection of Incompatible Updates

When a target version is incompatible (blocked, below minimum, above maximum, or not in the allowlist), the system rejects the update **before** calling `installOrUpdate`. The state is persisted with `compatibilityStatus: "incompatible"` and the `knownGoodVersion` is preserved unchanged.

## Blind Auto-Update Is Not Enabled

This system is a pure library with no HTTP routes, no process scheduler, and no network calls. Updates are never triggered automatically. All update operations require explicit invocation through `UpdateService.performUpdate()`, and every update must pass all validation gates before activation. There is no background polling, no scheduled updater, and no automatic activation path.
