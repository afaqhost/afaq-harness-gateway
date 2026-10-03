# Repository Development Rules

These instructions apply to the entire repository. They are written for both
human contributors and coding agents. A more specific `AGENTS.md` in a future
subdirectory may add stricter local rules but must not weaken these rules.

## Objective

Keep the gateway secure, understandable, asynchronous, and easy to extend. Make
the smallest change that fully solves the stated problem. Do not use an existing
architectural violation as a pattern for new code.

## Required dependency direction

```text
app/api -> app/services -> app/repositories -> app/db
                         -> app/clients -> external CLI
                         -> app/transport for wire mechanics
```

- `app/api/` owns HTTP/WebSocket parsing, dependencies, status codes, and response
  shaping. Controllers should delegate a use case instead of implementing it.
- `app/services/` owns business rules and orchestration. It must not depend on
  FastAPI request or response objects.
- `app/repositories/` owns persistent queries and transaction-focused data
  access. New controller SQL is not allowed.
- `app/clients/` is the only layer that knows harness command lines and output
  formats. All harnesses implement the `HarnessAdapter` contract.
- `app/transport/` owns SSE identity, replay, formatting, and heartbeat mechanics;
  it must not decide business outcomes.
- `app/shared/` contains dependency-light leaf helpers. It must not import from
  `app/api`, `app/services`, or `app/repositories`.
- `app/config/` and `app/core/config.py` own settings and composition. Do not read
  environment variables throughout unrelated modules.

`app/api/chat.py`, `app/api/openai.py`, and `app/static/app.js` contain known
legacy concentration. Change them carefully and move new reusable logic toward
the proper layer instead of adding more inline orchestration.

## Code rules

- Prefer explicit, typed inputs and return values over hidden state.
- Keep functions focused on one responsibility. Extract a named unit when logic
  has independent rules, failure modes, or tests.
- Reuse established services, repositories, adapters, and error shapes. Do not
  create a parallel implementation for convenience.
- Avoid speculative abstractions, compatibility shims without a caller, and dead
  code. Every new abstraction needs a current use.
- Catch the narrowest useful exception. Preserve cancellation and never hide an
  unexpected failure with `except Exception: pass`.
- Do not log credentials, Bearer tokens, raw API keys, environment secrets,
  prompts, or raw harness stderr.
- Do not add dependencies unless the standard library and existing dependencies
  are insufficient. Explain any new dependency in the PR.

## Async, database, Redis, and subprocess rules

- Never run blocking filesystem, network, database, Redis, or subprocess work on
  the event loop.
- Await created work or manage it through an owned lifecycle. Do not leave
  fire-and-forget tasks behind.
- Keep database sessions short. Do not hold a transaction or connection while a
  harness runs or an SSE stream remains open.
- Quota admission must use the reservation/finalization/release workflow in
  `app/services/quota_service.py`; a read-then-write counter is not acceptable.
- Use the shared async Redis provider and retain documented in-memory fallback
  behavior. Never add synchronous Redis calls to async request paths.
- A spawned process must have bounded output, timeout/cancellation handling, and
  deterministic termination and reaping. Do not expose raw stderr to clients.
- Stream replay keys must include the authenticated user, resource, and stream
  identity. Never share replay state across independent requests.

## Security invariants

- Dashboard, administration, credential, and terminal routes accept JWTs only.
- API keys are limited to `/v1/*` model access and must never authorize dashboard
  or terminal operations.
- Preserve inactive-user checks, role checks, model allow-lists, quotas, global
  rate limits, trusted-proxy handling, and request IDs.
- Raw API keys are one-time-display secrets; only hashes are stored.
- Credential profiles remain encrypted at rest.
- Production must fail fast on weak or placeholder secrets.
- The administrator terminal is privileged functionality. Any terminal change
  requires explicit authorization, lifecycle, and isolation tests.

## Testing rules

Place tests according to what they prove:

- `tests/unit/`: one component with controlled collaborators;
- `tests/integration/`: database, route, or multi-component behavior;
- `tests/contract/`: public payload, error, SSE, and tool contracts;
- `tests/security/`: authentication, authorization, secret, and trust boundaries;
- `tests/performance/`: latency, heartbeat, and load properties; and
- `tests/e2e/`: complete user flows.

Every bug fix needs a regression test that fails without the fix. Test both the
success path and relevant failure, cancellation, timeout, and cleanup paths.
Tests must be deterministic and must not require live provider accounts or real
harness installations.

Before handoff or review, run:

```bash
make check
git diff --check
```

For container changes, also run `docker compose config` and build the image.

## Documentation rules

Update documentation in the same change when modifying routes, environment
variables, authentication, model identifiers, SSE events, setup commands, or
operator responsibilities. Verify every documented command and file path against
the repository. Use placeholders for secrets and never invent static model names
when `/v1/models` is authoritative.

Do not commit generated graphs, caches, local databases, environment files,
coverage output, editor state, or coding-tool preference metadata.

## Definition of done

A change is complete only when:

1. behavior and scope match the issue or request;
2. code is placed in the correct layer without increasing known coupling;
3. security, async, transaction, subprocess, and compatibility effects were
   considered;
4. tests cover the change and `make check` passes without warnings;
5. user and operator documentation is accurate;
6. the diff contains no secrets, generated artifacts, or unrelated changes; and
7. the PR template contains concrete verification evidence.
