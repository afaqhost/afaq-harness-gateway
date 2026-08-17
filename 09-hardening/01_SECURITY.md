# Security Hardening

## API

- Authenticate every `/v1/*` endpoint.
- Validate request size.
- Validate model allowlists.
- Reject unknown CLI options.
- Do not allow arbitrary executable paths from API input.

## Process execution

- `shell: false`.
- Minimal environment.
- Timeouts.
- Process-group cleanup where needed.
- No Docker socket.
- No host filesystem mount unless explicitly required and tightly scoped.

## Network

Prefer a private Docker network, Cloudflare Tunnel + Access, Tailscale, or a hardened HTTPS reverse proxy. Do not expose the gateway directly without an authentication layer.

## Secrets

Keep harness account configuration in persistent protected volumes or a supported secret store. Never bake secrets into images or Git.
