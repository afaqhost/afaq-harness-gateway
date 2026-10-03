# Versioning and releases

Afaq Harness Gateway uses [Semantic Versioning](https://semver.org/):
`MAJOR.MINOR.PATCH`, with an optional prerelease suffix.

- Increment `MAJOR` for incompatible public API or configuration changes.
- Increment `MINOR` for backward-compatible features.
- Increment `PATCH` for backward-compatible fixes.
- Use `-alpha.N`, `-beta.N`, or `-rc.N` before a stable release, for example
  `0.1.0-beta.2`.

The default application version is defined by `Settings.version` in
`app/core/config.py`. Operators can override it with `VERSION` in `.env`; this
is useful for downstream builds, but official releases must update the default.
The version appears in the dashboard, FastAPI metadata, and `/health` response.

## Release checklist

1. Choose the next version and update `app/core/config.py`, `.env.example`, the
   README release badge, and version examples in the documentation.
2. Move completed entries from `Unreleased` in `CHANGELOG.md` into a dated
   version heading. Keep the categories relevant to the release: `Added`,
   `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`.
3. Run `make check` and `git diff --check`.
4. Commit the release changes with `chore(release): prepare VERSION`.
5. Create an annotated Git tag named `vVERSION`, such as
   `v0.1.0-beta.2`, and push the commit and tag.
6. Create the GitHub release from `.github/RELEASE_TEMPLATE.md`. Mark alpha,
   beta, and release-candidate versions as prereleases.
7. Verify the published installation and confirm `/health` returns the expected
   version.

Do not reuse or move an already published tag. If a release is incorrect,
publish a new patch or prerelease number.
