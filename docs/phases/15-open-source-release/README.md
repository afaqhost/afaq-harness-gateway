# Phase 15 — Open Source Release

## Objective

Prepare the project for a public Open Source release after the platform phases are stable.

## License

Use **Apache-2.0** for the Afaq project.

Benefits:
- permissive commercial use
- broad integration compatibility
- explicit patent grant
- low adoption friction

Before release, verify the exact license of every dependency and preserve required notices.

## Release requirements

- reproducible Docker build
- `.env.example` without secrets
- installation guide
- supported Harness versions documented
- Harness definition documentation
- adapter contribution guide
- testing instructions
- security policy
- threat model
- compatibility/version policy
- changelog
- CI green
- license and third-party notices
- architecture documentation
- known limitations
- upgrade/migration notes
- example configuration

## Contribution workflow

Contributors should be able to add a Harness with a bounded change set:

```text
Definition
+
Adapter
+
Fixtures
+
Contract tests
+
Optional real smoke test
+
Version/capability docs
```

Adapters must not require unrelated runtime changes.

## Release gates

Before the first tagged release:

- clean checkout passes typecheck
- full test suite passes
- Docker build is reproducible
- security review is current
- no secrets are committed
- third-party notices are complete
- documented installation works
- contributor workflow works
- release artifacts are versioned
- current Harness compatibility is documented

## Non-goals

Do not add billing, marketplace, Kubernetes, multi-region, or provider-subscription resale to the Open Source core.
