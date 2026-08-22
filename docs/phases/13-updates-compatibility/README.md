# Phase 13 — Updates + Compatibility

## Objective

Make Harness upgrades observable and safe.

## Scope

Represent:

- installed version
- latest known version
- supported version range
- update availability
- compatibility state
- post-update health
- known-good state

## Safe update flow

```text
Update available
    ↓
Compatibility check
    ↓
Backup if needed
    ↓
Install/update
    ↓
Verify version
    ↓
Adapter contract test
    ↓
Health check
    ↓
Activate or reject
```

Do not blindly activate an incompatible version.

## Auto-update

Blind automatic updates are out of scope.

Any future automated update flow must be:

- opt-in
- compatibility checked
- health checked
- reversible where practical

## CLI drift

Harness CLI output can change between versions.

The compatibility layer should support:

- version ranges
- parser fixture versions
- known incompatible versions
- compatibility notes

## Acceptance criteria

- Versions are persisted and queryable.
- Compatibility is explicit.
- Update checks exist.
- Post-update verification exists.
- Known-bad versions cannot silently become active.
- Adapter contract tests are integrated into update validation.
- Current supported Harnesses remain stable.
