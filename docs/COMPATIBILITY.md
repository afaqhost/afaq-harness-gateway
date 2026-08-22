# Version Compatibility

This document describes the version compatibility and safe-update system
implemented in `src/updates/`.

## Version range model

A `VersionRange` defines compatibility constraints for a harness definition:

- **blocked** -- known-bad versions; checked first and always rejected
- **allowed** -- explicit allowlist; if non-empty, only listed versions pass
- **minimum** -- inclusive lower bound (semver comparison)
- **maximum** -- inclusive upper bound (semver comparison)
- **notes** -- informational notes carried through to results

Evaluation order: blocked -> allowed -> minimum -> maximum -> supported.

A version that passes all checks receives status `supported`. A version that
fails any check receives status `incompatible`. When no range is provided the
status is `unknown`.

## Installed version tracking

The `VersionStateStore` persists one row per harness definition:

- **installedVersion** -- the currently installed version
- **latestKnownVersion** -- the newest version known to the system
- **compatibilityStatus** -- `supported`, `incompatible`, or `unknown`
- **knownGoodVersion** -- the last version that passed all update gates
- **notes** -- free-form compatibility notes
- **checkedAt** -- timestamp of the last state change

## Update availability

`UpdateService.checkForUpdate()` compares the installed version against the
latest known version. An update is available only when `latestKnownVersion` is
defined and is strictly newer (by semver comparison) than the installed
version. This method is read-only -- it never installs or activates anything.

## Safe update flow

`UpdateService.performUpdate()` executes an ordered gate sequence:

1. **Load state** -- requires an existing installed version in the store
2. **Resolve target** -- explicit `targetVersion` or latest known version
3. **Compatibility check** -- rejects before installing if target is not
   `supported`
4. **Install** -- calls the injected `installOrUpdate` function
5. **Version verification** -- runs the version command via `detectVersion()`
   and confirms the output matches the target version exactly
6. **Adapter contract test** -- runs `runAdapterContractTest()` against the
   adapter (health check, model listing, and a test run with a simple message)
7. **Post-update health check** -- calls `adapter.health()` one final time
8. **Activation** -- only after all gates pass: persists the new state with
   `knownGoodVersion` set to the target

If any gate fails, the update is rejected. The installed version and
known-good version are preserved. No partial state is committed.

## Blind auto-update is not enabled

The update system is a pure library with no HTTP routes, no process scheduler,
and no network calls. Updates are never triggered automatically. All update
operations require explicit invocation through `UpdateService.performUpdate()`,
and every update must pass all validation gates before activation. There is no
background polling, no scheduled updater, and no automatic activation path.

## Afaq gateway versioning

The Afaq Harness Gateway follows semantic versioning (MAJOR.MINOR.PATCH). The
current version is pre-1.0, meaning:

- Breaking changes may occur between minor versions (0.x -> 0.y).
- Patch versions (0.x.y) contain backward-compatible fixes only.
- The first stable release will be 1.0.0.

The version constant is defined in `src/version.ts` as `GATEWAY_VERSION`.
