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

We aim to acknowledge within 48 hours and provide a fix or mitigation
timeline within 7 days. We will credit reporters unless anonymity is requested.

## Production Security Notes & Hardening Checklist

- **Authentication Boundaries:**
  - **API Keys are scoped strictly to `/v1/*`:** External API keys (`afaq_...`) cannot authenticate protected dashboard, user management, key management, or terminal routes. Protected `/api/*` endpoints and the OS terminal require a signed JWT; public authentication/setup endpoints remain intentionally unauthenticated.
  - **OS Terminal Access:** The browser terminal (`/terminal`) is a privileged tool granting interactive shell access on the gateway host/container. It is strictly restricted to administrative users with valid JWTs and is supported only on POSIX hosts (`openpty` + `posix_spawn`).
- **Secret Hygiene & Fail-Fast Validation:**
  - Generate strong, distinct values for `SECRET_KEY` and `CREDENTIALS_KEY` using `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`. Never use the same key for both purposes.
  - Set `DEBUG=false` in production. When `DEBUG=false`, the gateway enforces fail-fast startup validation that immediately aborts if secrets are weak, shorter than 32 characters, or match the public placeholder strings from `.env.example`.
  - Never commit `.env`, SQLite databases, or credential files to version control.
- **Persistence & Migration Framework Limitation:**
  - **Backup Requirement:** Back up the `data/` directory and persistent Docker volumes before performing software upgrades.
  - **No Schema Migrations:** Database schemas are auto-created at startup via SQLAlchemy (`Base.metadata.create_all`). There is no built-in schema migration or rollback framework (e.g., Alembic); upgrades requiring schema alterations must be verified prior to deployment.
- **Network Isolation & Reverse Proxy:**
  - **Loopback Publishing:** `docker-compose.yml` intentionally binds the published gateway port strictly to `127.0.0.1:3500`. Do not publish to `0.0.0.0` without access controls.
  - **TLS Termination:** Put a TLS-terminating reverse proxy (Nginx, Caddy, Traefik) in front of the gateway for remote exposure. Configure WebSocket upgrading for `/terminal`; disable response buffering and allow long read timeouts for SSE streams.
  - **Trusted Proxies:** When operating behind a reverse proxy, set `TRUSTED_PROXIES` to the proxy's IP addresses so that client IP rate limiting parses forwarded headers safely without permitting spoofing.
  - **CORS:** Restrict `ALLOWED_ORIGINS` to your exact production origins (do not use wildcards).
- **Container Isolation:**
  - The container image executes as the unprivileged `node` user.
  - The `docker-compose.yml` configuration isolates Redis on an internal bridge network with no published host ports and does not mount the host `docker.sock`. Do not re-add `docker.sock` in production.
- **Credential Rotation:**
  - Rotate API keys via `POST /api/admin/keys/{id}/rotate`. The previous key hash is revoked immediately upon rotation.
- **Project Support Actions:**
  - Keep `GITHUB_ISSUES_TOKEN` server-side and scope it to the configured repository with only issue-creation access. The dashboard issue form is for ordinary bugs; use private vulnerability reporting for security defects.
  - The administrator-only update action runs `git pull --ff-only` only from a clean checkout whose `origin` matches `GITHUB_REPOSITORY`. Review the configured remote as a code-execution trust boundary and restart the service after an update.

## What Is Out of Scope

- Harness CLIs themselves (Codex, OpenCode, Claude Code, Antigravity, etc.) are third-party tools; follow their upstream security advisories for token handling and execution permissions.
- The gateway does not implement multi-factor authentication (MFA); front it with your identity provider or VPN if required.
