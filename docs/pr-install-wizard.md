## Summary

Fixes two install-time bugs and adds a one-command install wizard that works
on any host (bare metal, Docker, WSL, Apple Silicon).

### Bug fix: harness installs but is not visible

After a successful harness install the gateway reported "not installed" and
the chat dropdown stayed empty. Two root causes:

1. **`is_installed()` relied on `shutil.which()` only.** Some installers
   drop the binary outside `PATH` (`~/.local/bin/agy` for Antigravity, npm
   globals with a custom prefix, Homebrew on Apple Silicon when uvicorn was
   launched from `/usr/bin`, etc.). The fix adds a per-adapter
   `install_search_paths` and a `_executable_on_disk()` helper that consults
   `shutil.which()` first then walks the declared paths with `~`/`$VAR`
   expansion. `run()`/`stream()` now resolve the executable to an absolute
   path so the subprocess doesn't depend on `PATH` either.

   `resolve_command()` is conservative — it only rewrites `command[0]` when
   it equals `self.executable`, so adapters that build `["bash", "-c", ...]`
   commands (and the existing test fixtures that do the same) keep working.

2. **Install job didn't refresh the model cache.** `MODEL_CACHE["agy"]`
   stayed empty after install, so `agy//*` models never reached `/v1/models`
   or chat. `HarnessJobService` now accepts an optional `on_success(adapter)`
   callback that fires when a job settles in `completed`. `app.main.lifespan`
   wires it to `refresh_models()` via a public `set_on_success()` setter.

### New: `scripts/install.sh` install wizard

- Detects Python, pip, venv, node/npm, docker, redis-server, git, curl, build
  tools.
- Asks once: **native** or **docker**.
- Installs missing prerequisites for the chosen path via `apt`/`dnf`/`apk`/
  `brew` (Debian/Ubuntu, RHEL/Fedora, Alpine, Arch, macOS).
- For native: NodeSource setup script if `node` missing, `python3-dev
  libffi-dev libssl-dev build-essential` **only** if `pip` can't fetch a
  wheel for `greenlet`/`cryptography` (so most installs never touch the
  toolchain).
- For docker: `get.docker.com` convenience script on Linux, `brew install
  --cask docker` on macOS. Hands off to `docker compose up -d --build`.
- Idempotent: re-running is a no-op when everything is already installed.
- `--harness <name>` flag installs harness CLIs in the same pass
  (`agy`, `opencode`, `claude`, `codex`, `pi`).
- `--dry-run` prints actions without executing.
- `--no-system` skips OS-package installs (CI mode).
- Non-zero exit codes per failure mode (`1` cancelled, `2` missing tool,
  `3` pip wheel build failed even with build deps, `4` docker daemon
  unreachable).

### Makefile changes

- `make setup` now invokes the wizard by default.
- `make setup-fast` — non-interactive CI variant (`--no-prompt --path=native
  --no-system`).
- `make setup-legacy` — the old `scripts/setup.sh` flow, kept untouched.
- `make install-wizard` — alias for `make setup`.

### Verification

- `python -m compileall -q app` — clean
- `node --check app/static/app.js` — OK
- `bash -n scripts/install.sh` — OK
- `pytest -q` — **216 passed** (the one flaky perf test
  `test_conversation_creation_latency_under_threshold` passes in isolation)

## How to test locally

```bash
# interactive
make setup

# non-interactive
make setup-fast
make setup ARGS="--path=native --harness agy"
make setup ARGS="--path=docker"

# dry-run (no system changes)
bash scripts/install.sh --no-prompt --path=native --dry-run

# legacy flow still available
make setup-legacy
```

## What's NOT a bug

- The legacy `scripts/setup.sh` is unchanged and still works via
  `make setup-legacy`.
- `Dockerfile` and `docker-compose.yml` are unchanged (already correct for
  the container path).
- The existing 216 tests still pass.
