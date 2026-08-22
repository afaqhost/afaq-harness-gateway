# Adapter Contribution Guide

This document describes how to add a new Harness adapter to Afaq Harness
Gateway. An adapter is a bounded, self-contained change set that does not
touch the generic runtime.

## What is an adapter?

An adapter bridges Afaq's gateway to a local Harness CLI. It implements
the `HarnessAdapter` interface defined in `contracts/HARNESS_ADAPTER.md`:

```ts
interface HarnessAdapter {
  id: string;
  health(): Promise<{ ok: boolean; message?: string }>;
  listModels(): Promise<string[]>;
  run(request: HarnessRunRequest): AsyncGenerator<HarnessEvent>;
  cancel(runId: string): Promise<void>;
}
```

The contract, event types, and responsibilities are specified in
`contracts/HARNESS_ADAPTER.md`. Do not invent a new contract.

## Scope rules

An adapter owns CLI-specific behavior only:

- locating the CLI binary;
- constructing CLI arguments;
- serializing messages when native chat input is unavailable;
- parsing stdout incrementally;
- extracting usage, session ID, and final text;
- enforcing timeouts and cancellation.

An adapter must **not** touch:

- the generic HTTP routing layer;
- API-key authentication;
- the run queue or concurrency policy;
- the Chat UI;
- the SQLite schema.

## Safety requirements

- Spawn child processes with `shell: false`. Never interpolate user input
  into a shell string.
- Use the minimal-env allowlist pattern from `src/harness/env.ts`. Do not
  forward the host environment by default.
- Close the child's stdin immediately after writing input, to avoid hangs
  from CLIs that wait on stdin EOF.
- Use detached process groups on non-Windows platforms for reliable
  cleanup.

## Change set

A complete adapter contribution includes:

1. **Harness definition** -- register the CLI in the harness registry.
2. **Adapter implementation** -- a new file in `src/harness/` implementing
   `HarnessAdapter`.
3. **Fixtures** -- deterministic CLI shims in `testing/fixtures/` for
   contract testing without real credentials.
4. **Contract tests** -- add the adapter to the shared contract suite in
   `src/harness/adapter-contract.test.ts`.
5. **Optional real smoke test** -- an opt-in test that runs against the
   real CLI with live credentials. This is never required in CI.
6. **Version and capability docs** -- document supported CLI versions,
   known limitations, and model availability.

## Step-by-step checklist

- [ ] Read `contracts/HARNESS_ADAPTER.md` and understand the full
      contract.
- [ ] Create `src/harness/<cli-name>.ts` implementing `HarnessAdapter`.
- [ ] Use `shell: false` and `buildMinimalEnv()` from `src/harness/env.ts`
      when spawning the CLI.
- [ ] Create deterministic fixture shims in
      `testing/fixtures/<cli-name>/`.
- [ ] Add the adapter to the shared contract test in
      `src/harness/adapter-contract.test.ts`.
- [ ] Verify: `npm run typecheck` passes.
- [ ] Verify: `npm test` passes.
- [ ] (Optional) Add a real smoke test gated behind an environment
      variable (e.g., `AFAQ_SMOKE_<CLI>=1`). Document how to run it.
- [ ] Document supported CLI versions and known limitations.
- [ ] Open a pull request against `main`.

## Existing adapters as reference

The repository includes four adapters. Use them as reference
implementations:

| CLI | Adapter | Fixtures |
|-----|---------|----------|
| Command-Code | `src/harness/command-code.ts` | `testing/fixtures/command-code/` |
| Codex | `src/harness/codex.ts` | `testing/fixtures/codex/` |
| Claude Code | `src/harness/claude-code.ts` | `testing/fixtures/claude-code/` |
| OpenCode | `src/harness/opencode.ts` | `testing/fixtures/opencode/` |
