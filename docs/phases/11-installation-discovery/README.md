# Phase 11 — Installation & Discovery

## Objective

Allow the platform to discover installed Harnesses and safely install supported Harnesses selected by the operator.

## Scope

Implement:

- binary discovery
- path resolution
- version detection
- supported-version checks
- installation state
- installation metadata
- post-install verification
- health verification

## User flow

```text
Choose Harness
    ↓
Discover existing installation
    ↓
If missing: install
    ↓
Verify version
    ↓
Register installation
    ↓
Health check
```

## Security

Installation must be driven by trusted, versioned definitions.

Never:

- execute arbitrary installer commands from user input
- turn raw user input into shell strings
- download untrusted binaries without verification
- allow definitions to become unrestricted scripts

Use controlled internal installation strategies.

## Multiple Harnesses

The operator may install any subset of supported Harnesses.

No global assumption may require Command-Code to exist.

## Acceptance criteria

- Installed Harnesses can be discovered.
- Versions can be detected.
- Unsupported versions are reported.
- At least one controlled installation strategy is implemented.
- Installation records persist safely.
- Multiple Harness installations coexist.
- Post-install health is verified.
- Existing adapters remain functional.
