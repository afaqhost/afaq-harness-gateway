# Open Source Release

## License

Recommended project license: **Apache-2.0**.

Why:

- permissive commercial use;
- broad compatibility for users and integrators;
- explicit patent grant;
- lower adoption friction than copyleft licenses.

Before publishing any code derived from dependencies, verify each component's exact license and keep required notices.

## Release requirements

- reproducible Docker build;
- `.env.example` without secrets;
- clear installation guide;
- supported versions documented;
- adapter contribution guide;
- test instructions;
- security policy;
- changelog;
- CI green;
- license and third-party notices.

## Contribution model

Adapters should be independently testable and should not require changes to unrelated runtime layers.
