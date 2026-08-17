# Additional Adapters

Add adapters only after Command-Code is stable.

Recommended order:

1. Codex.
2. Claude Code.
3. OpenCode.

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
