# Execution Rules

## Non-negotiable rules

1. Work phase-by-phase.
2. Do not redesign the project during implementation without an ADR.
3. Prove the runtime path before building a polished UI.
4. Keep harness-specific code inside adapters.
5. Use safe child-process spawning (`shell: false` or the language equivalent).
6. Never pass arbitrary CLI arguments from the client.
7. Never expose credentials in logs or API responses.
8. Keep tests deterministic and avoid paid services in CI.
9. Use a fake harness for adapter/integration tests.
10. Keep external API contracts stable and versioned.

## Per-task workflow

- Read the relevant docs first.
- Inspect the existing implementation.
- Make the smallest correct change.
- Run targeted tests.
- Run the wider suite before phase completion.
- Update documentation and fixtures.
- Report assumptions and known limitations.

## Failure handling

If a harness CLI changes:

1. Capture safe stdout/stderr diagnostics.
2. Check `--version` and `--help`.
3. Update parser fixtures and adapter config.
4. Do not weaken the common contract just to support one CLI version.
