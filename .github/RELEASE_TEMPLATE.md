# Afaq Harness Gateway vX.Y.Z

<!--
Replace every placeholder, remove empty sections, and keep this release focused
on changes since the previous version. Mark alpha, beta, and RC releases as
GitHub prereleases.
-->

## Release status

- Channel: Stable / Release candidate / Beta / Alpha
- Previous version: `vX.Y.Z`
- Supported upgrade path: `vX.Y.Z` -> `vX.Y.Z`

## Summary

<!-- In two or three sentences, explain who should update and why. -->

## What's new

- <!-- User-visible feature or improvement. -->

## Fixed

- <!-- Bug fix and its user-visible effect. -->

## Security

- <!-- Security change, or write "No security-specific changes." -->

## Breaking changes

<!-- List incompatible API, configuration, or database changes. Write "None" when applicable. -->

## Upgrade instructions

1. Back up the database and configuration.
2. Read the breaking changes and update `.env` if required.
3. Pull or download `vX.Y.Z` and reinstall dependencies.
4. Restart the gateway.
5. Confirm `/health` reports `X.Y.Z` and run a test request.

## Verification

- [ ] `make check` passes without warnings.
- [ ] `git diff --check` passes.
- [ ] Native installation was smoke-tested.
- [ ] Docker configuration and image were checked when affected.
- [ ] Upgrade instructions were tested when data or configuration changed.
- [ ] The changelog and documentation match this release.

## Known issues

- <!-- Link relevant issues, or write "No new known issues." -->

## Contributors

Thank you to everyone who contributed to this release.

**Full changelog:** `vPREVIOUS...vX.Y.Z`
