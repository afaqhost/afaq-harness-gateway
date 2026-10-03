# Contributing to Afaq Harness Gateway

Thank you for contributing. This guide describes the shortest safe path from a
fresh checkout to a reviewable pull request.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- For a security vulnerability, follow [SECURITY.md](SECURITY.md) instead of
  opening a public issue.
- Read [AGENTS.md](AGENTS.md). Its architecture and quality rules apply to every
  change, whether it is written by a person or a coding agent.
- Keep one pull request focused on one problem.

## Set up the development environment

Requirements are Python 3.10 or newer, `pip`, virtual-environment support, Git,
and `curl`. Node.js is used to validate dashboard JavaScript and to install many
harness CLIs.

```bash
git clone <YOUR_FORK_URL>
cd afaq-harness-gateway
make setup-fast
make check
```

Use `make setup` instead when you want the interactive installer to inspect and
optionally install system prerequisites. To run the application:

```bash
make dev
```

Open <http://127.0.0.1:3500/setup> for a fresh database or
<http://127.0.0.1:3500/login> after setup. Tests do not need real provider
accounts, harness binaries, or an external Redis server.

## Choose the correct layer

Use this dependency direction for new code:

```text
app/api -> app/services -> app/repositories or app/clients
                         -> app/transport for wire mechanics
```

| Change | Primary location |
| --- | --- |
| Parse an HTTP request or shape a response | `app/api/` |
| Enforce a business rule or coordinate a use case | `app/services/` |
| Read or write persistent data | `app/repositories/` |
| Invoke or parse a harness CLI | `app/clients/` |
| Implement SSE identity, replay, or heartbeat behavior | `app/transport/` |
| Add a dependency-light helper | `app/shared/` |
| Change browser behavior or styling | `app/static/` |

Do not add new SQL to a controller, call FastAPI from a service, or bypass the
`HarnessAdapter` boundary to run a CLI. Existing thick controllers are technical
debt, not examples to copy. See [Architecture](docs/architecture.md) for the
current state and intended boundaries.

## Make the change

1. Reproduce the problem or define the expected behavior.
2. Add or update the smallest test that proves that behavior.
3. Implement the smallest coherent change in the correct layer.
4. Test failure, cancellation, timeout, and authorization paths when relevant.
5. Update documentation when routes, configuration, output, or operator behavior
   changes.
6. Review the diff for accidental secrets, generated output, and unrelated edits.

Prefer small functions with explicit inputs and return values. Reuse existing
services and helpers before creating another abstraction. Avoid hidden global
state, broad exception handling, untracked background tasks, blocking work in
async paths, and long-lived database sessions around subprocess or network I/O.

## Run the quality gate

```bash
make check
git diff --check
```

`make check` runs Python bytecode compilation, JavaScript syntax validation, and
the entire pytest suite with warnings treated as errors.

During development, a targeted test is useful:

```bash
.venv/bin/python -m pytest -q tests/unit/test_model_utils.py -W error
```

Run the full gate before opening or updating a pull request. If the change
affects Docker or Compose, also run:

```bash
docker compose config
docker build -t afaq-harness-gateway:local .
```

## Commit and open the pull request

Use a short conventional commit subject:

```text
feat: add provider model discovery
fix: release quota after cancelled stream
docs: clarify reverse proxy configuration
test: cover invalid stream identities
refactor: move conversation queries to repository
```

In the pull request:

- explain the problem and the behavior after the change;
- identify affected architecture layers;
- describe security, data, concurrency, and compatibility impact;
- list the exact verification commands and results; and
- include screenshots only when visible UI behavior changes.

Complete every applicable item in the repository pull-request template. A PR is
ready for review when it is focused, documented, warning-free, tested, and does
not weaken an existing security or architecture boundary.

Maintainers preparing a version should follow the [release guide](docs/releases.md)
and start from [the release template](.github/RELEASE_TEMPLATE.md).

## Review expectations

Reviewers check correctness first, then security, ownership of database and
subprocess resources, async safety, architecture direction, tests, and
documentation. They may request that unrelated cleanup be split into another PR.

Be respectful, assume good intent, and keep discussion focused on observable
behavior and maintainability.
