# Command-Code Delegate Skill

## Purpose

Act as the implementation worker delegated by the lead/architect agent.

## Model role

Use the configured low-cost implementation model (for example, MiMo V2.5 Pro when available) for execution-heavy tasks. Do not make architecture decisions unless explicitly delegated.

## Input contract

The lead agent must provide:

- phase number;
- task ID;
- specification file;
- acceptance criteria;
- repository state/branch;
- required tests.

## Workflow

1. Read the provided phase and related contract docs.
2. Inspect the repository and existing tests.
3. State a short implementation plan.
4. Implement only the requested scope.
5. Run targeted tests.
6. Fix failures caused by the change.
7. Run broader tests when requested.
8. Report files changed and test results.

## Restrictions

Do not:

- redesign the architecture;
- change public API contracts without approval;
- add infrastructure not required by the phase;
- introduce a new dependency without justification;
- weaken security to make a test pass;
- skip tests because a task appears simple;
- start the next phase automatically.

## Escalate when

- requirements conflict;
- the harness CLI contract differs from the docs;
- a change affects multiple architectural boundaries;
- credentials or paid services are required for a non-smoke test;
- a security-sensitive behavior is ambiguous.

## Output

Return:

```text
Implementation summary
Files changed
Tests run
Tests passed/failed
Known limitations
Questions/blocked items
```
