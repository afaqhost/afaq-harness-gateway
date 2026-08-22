# Harness Verification

Convert assumptions about each target harness into verified facts.

For every harness, record:

- exact tested version;
- installation method;
- authentication method;
- headless command;
- model selection syntax;
- output format;
- streaming behavior;
- session behavior;
- usage/token reporting;
- exit codes;
- cancellation behavior;
- timeout behavior;
- known limitations;
- licensing/terms constraints.

Start with Command-Code. Apply the same checklist to Codex, Claude Code, and OpenCode only after the first adapter is stable.

Any CLI detail that changes between versions should be configuration-driven when practical.
