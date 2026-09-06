# Contributing to Afaq Harness Gateway

Thanks for considering a contribution. This document keeps the workflow short.

## Development Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
# generate secrets for local dev (or keep DEBUG=true for relaxed check)
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
# edit .env to set SECRET_KEY and CREDENTIALS_KEY
python -m uvicorn app.main:app --host 0.0.0.0 --port 3500
```

Open `http://127.0.0.1:3500/login` and bootstrap the first admin via `docs/installation.md`.

## Checks Before Sending a PR

```bash
python -m compileall -q app
node --check app/static/app.js
.venv/bin/python -m pytest -q   # 204 tests, ~55s
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
