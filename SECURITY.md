# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Email the maintainers or use GitHub's private vulnerability reporting
(`Security` → `Report a vulnerability`). Include:

- Affected version / commit
- Reproduction steps or proof-of-concept (without exfiltrating real secrets)
- Impact assessment

We aim to acknowledge within 48 hours and to provide a fix or mitigation
timeline within 7 days. We will credit reporters unless anonymity is requested.

## Security Hardening Checklist (self-hosted)

- Generate strong `SECRET_KEY` and `CREDENTIALS_KEY` (each `secrets.token_urlsafe(48)`) and never commit `.env`.
- Set `DEBUG=false` in production — the app fails fast if secrets are weak or empty.
- Put a TLS-terminating reverse proxy in front of the gateway and restrict
  `ALLOWED_ORIGINS` to your exact origins (no wildcard).
- Keep `data/` and `storage/` off version control and back them up securely.
- Rotate API keys via `POST /api/admin/keys/{id}/rotate` (old key revoked immediately).
- The `docker-compose.yml` no longer mounts `docker.sock`; do not re-add it in production.
- Review `app/core/config.py:63` fail-fast check: weak placeholder secrets are rejected when `DEBUG=false`.

## What Is Out of Scope

- Harness CLIs themselves (Codex, OpenCode, etc.) are third-party; follow their
  security advisories for installation and credential handling.
- The gateway does not implement OAuth/MFA; front it with your IdP if needed.
