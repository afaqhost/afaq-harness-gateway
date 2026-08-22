# Contributing

Thank you for considering a contribution to Afaq Harness Gateway.

## Reporting issues

Open a GitHub issue with:

- a clear title;
- steps to reproduce;
- expected vs. actual behavior;
- version or commit hash;
- relevant logs (redact secrets first).

Security issues follow a separate private process. See `SECURITY.md`.

## Proposing changes

1. Fork the repository and create a branch from `main`.
2. Make your changes.
3. Ensure the full check suite passes:

```sh
npm ci
npm run typecheck
npm test
```

4. Open a pull request against `main` with a clear description of what
   changed and why.

## Definition of Done

A pull request is ready to merge when:

- `npm run typecheck` passes with no errors.
- `npm test` passes with no failures.
- New behavior has test coverage.
- No secrets, tokens, or credentials are committed.
- Documentation is updated if the change affects public behavior.

## Adding a new Harness adapter

Adapter contributions follow a dedicated workflow. See
`docs/ADAPTER_CONTRIBUTION.md` for the full checklist and contract
requirements.

## Code style

- TypeScript, ESM (`"type": "module"`).
- No runtime npm dependencies. Use Node.js built-ins.
- Keep adapters self-contained. Do not modify the generic runtime, HTTP
  routing, auth, or queue policy to accommodate a single adapter.
- Follow existing patterns in the codebase.

## Licensing

All contributions are licensed under the Apache License, Version 2.0.
By submitting a pull request you agree to license your work under those
terms.
