# Contributing to Afaq Harness Gateway

Thanks for considering a contribution. This document keeps the workflow short.

## Development Setup

```bash
make setup   # venv + pip install + auto-generate .env secrets + mkdir data/storage
make dev     # → http://127.0.0.1:3500/setup on first DB (wizard), else /login
# check setup state:
make setup-status
# or create admin headlessly:
make bootstrap EMAIL=admin@example.com PASS=StrongPass123
```

Manual alternative:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --host localhost --port 3500
```

Open `http://127.0.0.1:3500/setup` on a fresh database — the wizard creates the first admin (auto-login) and lets you install harnesses inside the container. See `docs/installation.md`.

## Checks Before Sending a PR

```bash
make check          # compileall + node --check + pytest -q (204 tests, ~55s)
# or:
python -m compileall -q app
node --check app/static/app.js
.venv/bin/python -m pytest -q
```

- Keep controllers thin (`app/api/*` → one service call), business logic in `app/services/*`,
  data access only in `app/repositories/*`, external CLIs behind `app/clients/*` (see `DESIGN.md` and `docs/architecture.md`).
- Leaf utilities in `app/shared/*` must not import from `app/services`, `app/api`, etc.
- Prefer small, behavior-preserving commits: `refactor(scope): what moved + why`.
- Never commit `.env`, `data/`, `storage/`, or real keys. Tests use in-memory SQLite and do not need real harness binaries.

## Commit & PR Style

- Use conventional prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- One logical change per commit; include verification (`compileall` / `pytest` green).
- Update `docs/` when you change env vars, routes, or SSE events.

## Code of Conduct

Be respectful, assume good intent, and keep reviews focused on technical merit.
