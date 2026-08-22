# Additional Adapters

Add adapters only after Command-Code is stable.

Recommended order:

1. Codex.
2. Claude Code.
3. OpenCode.

## Extensibility Requirements

Phase 08 must preserve the architecture for multiple independently installed and configured Harnesses.

Do not hard-code Command-Code, Codex, Claude Code, or OpenCode as the universal/default runtime.

Each Harness must remain an independent adapter registered through the common adapter registry.

Harness-specific installation, configuration, authentication, capabilities, and CLI behavior must not leak into the generic runtime.

The implementation should allow multiple Harnesses to be enabled simultaneously.

Do not implement a full Harness installation manager, credential manager, or automatic updater in this phase unless explicitly required by the existing architecture. Those capabilities may be introduced in later phases.

## Implementation Requirements

For each adapter:

1. Verify the installed version.
2. Capture real headless command behavior.
3. Record parser fixtures.
4. Implement the common contract.
5. Add unit and contract tests.
6. Add an opt-in real smoke test.
7. Add model records and capabilities.
8. Document limitations.

Do not weaken the common adapter contract to mimic one CLI.
