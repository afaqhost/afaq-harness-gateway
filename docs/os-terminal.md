# OS Terminal — CasaOS-style live shell

The dashboard exposes a real POSIX shell over a WebSocket-served PTY.
Same shape as CasaOS's "Terminal" tile, VS Code's integrated terminal,
or JupyterLab's terminal — full TTY with ANSI colors, cursor control,
resize, signal forwarding, and live stdin/stdout.

## What it is

A single page at `/terminal` (sidebar link 06) that opens a real
login shell in the user's browser. The shell runs as the gateway
process's own user (root inside the default Docker image, your user
on a bare host). Type any command, hit Enter, see output. `vim`
works. `tmux` works. `htop` works.

That's all it is. No banner, no pre-loaded command, no harness auth
helpers — just a clean prompt waiting for input.

## Auth + access

The terminal endpoints are admin-only. Non-admins get `403`. This is
deliberate: opening a shell to the gateway host is a trusted operation.
Every start/stop is logged with the user id, terminal id, and shell path.

The WebSocket upgrade carries the same `Authorization: Bearer <jwt>`
header as the rest of the dashboard. Browsers forward headers on the WS
upgrade automatically.

## Endpoints

### `POST /api/admin/terminal/start`

Request body (all optional):

```json
{ "shell": "/bin/zsh", "cwd": "/srv", "cols": 100, "rows": 30 }
```

Response `200 OK`:

```json
{
  "terminal_id": "f3a1b2c4d5e6f7g8",
  "pid": 12345,
  "shell": "/bin/bash",
  "cwd": "/srv",
  "cols": 100,
  "rows": 30
}
```

Returns `503` with `{"error": {"code": "terminal_unavailable", ...}}`
on hosts without `pty.openpty` (Windows).

### `POST /api/admin/terminal/{terminal_id}/stop`

Kills the PTY (SIGTERM, then SIGKILL after 2 s). Idempotent — returns
`204` if the session was already gone.

### `GET /api/admin/terminal/{terminal_id}`

Returns the current state (no PTY access):

```json
{
  "alive": true,
  "cols": 100, "rows": 30,
  "cwd": "/srv", "pid": 12345, "shell": "/bin/bash",
  "uptime_seconds": 12.4, "idle_seconds": 0.8
}
```

### `WebSocket /api/admin/terminal/{terminal_id}/ws`

Bidirectional:

- **Client → server text frame:** raw stdin bytes (UTF-8).
  Or a JSON control message `{"type":"resize","cols":..,"rows":..}`.
- **Server → client text frame:** raw PTY output bytes (decoded with
  `errors="replace"`).
  Or `{"type":"exit","code":int}` when the shell exits.

On WS disconnect the server stops the PTY automatically.

## Reverse proxy notes

If you run the gateway behind nginx, Caddy, or Traefik, ensure your
proxy forwards WebSocket upgrades:

**nginx:**

```nginx
location /api/admin/terminal/ {
    proxy_pass http://127.0.0.1:3500;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;   # 1 day, so long-running shells survive
}
```

**Caddy 2.7+:** plain `reverse_proxy` already handles `Upgrade`.
**Traefik:** no extra config — detected automatically.

## Customizing the shell

The shell is `$SHELL` from the gateway process's environment, falling
back to `/bin/bash`. To use a different shell:

- **Docker:** add `ENV SHELL=/bin/zsh` to the `Dockerfile`, or set
  `SHELL=...` in `docker-compose.yml`.
- **Bare host / dev:** `SHELL=/bin/zsh .venv/bin/python -m uvicorn ...`.

The shell runs as the user that started the gateway (root inside the
default container image, your own user on a bare host).

## Limitations

- POSIX only. Windows refuses with `503`.
- One session per user (re-opening a new tab reuses the existing PTY).
- Sessions are in-memory and die on gateway restart. Run `tmux` inside
  the terminal if you want persistence.
- The shell runs as the gateway's user. `sudo` works if the user has
  it configured.
