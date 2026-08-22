# Security Policy

## Supported versions

The only release is v0.1.0 (unreleased 0.x). Security fixes are applied
to the `main` branch. There are no stable release branches yet.

## Reporting a vulnerability

Report security issues privately. Do **not** open a public issue.

- Open a private security advisory on GitHub, or
- Contact the maintainers at `security@example.invalid`

> **Note:** The address above is a placeholder. Replace it with a real
> contact before the first public release.

Include as much detail as you can: affected version/commit, reproduction
steps, and potential impact. You will receive an acknowledgement within
7 days.

### No secrets in reports

Do not include API keys, tokens, passwords, or other live credentials in
any issue, advisory, or pull request. If a credential appears in a report,
it will be treated as compromised and rotated immediately.

## Security boundary

Afaq Harness Gateway is a **self-hosted, single-node** application.

- It has **no built-in TLS termination**. Deploy it behind a private
  network, Cloudflare Tunnel + Access, Tailscale, or a hardened HTTPS
  reverse proxy with an auth layer.
- It spawns local Harness CLIs as child processes. The process boundary
  is the trust boundary between the gateway and each CLI.
- SQLite is the embedded store. Backups and secret rotation are
  operational responsibilities.

## Threat model

The full threat model and control inventory are documented at:

- `docs/phases/09-hardening/03_THREAT_MODEL.md` -- threats, controls, and residual risks
- `docs/SECURITY_MODEL.md` -- security model summary

## Scope

Out of scope for the open-source core:

- Multi-region or multi-tenant isolation (see `docs/phases/14-managed-deployment/` for
  managed-hosting guidance)
- Billing, marketplace, or subscription-resale logic
- Kubernetes or container-orchestration specifics
