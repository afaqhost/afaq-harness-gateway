# Agent Handoff

You are working on **Afaq Harness Gateway**.

The repository documentation is the source of truth.
Do not invent architecture, behavior, requirements, or scope that are not supported by the project documentation.

---

## 1. Core Principle

The project is implemented phase-by-phase.

A phase must be completed, tested, reviewed, documented, and committed before starting the next phase.

Never skip phases.

Never implement future phases unless explicitly authorized.

---

## 2. Required Documents

Before working on a phase, read:

1. `README.md`
2. `ROADMAP.md`
3. `EXECUTION_ORDER.md`
4. `PHASE_INDEX.md`
5. The assigned phase documentation
6. Relevant ADRs
7. Relevant architecture, API, and testing documentation
8. `ORIGINAL_SPEC.md` only when additional clarification is required

Inspect the current repository and git state before changing anything.

---

## 3. Agent Roles

### Lead / Architect

The Lead / Architect is responsible for:

- Understanding the project architecture.
- Controlling scope.
- Making architecture decisions.
- Resolving difficult technical issues.
- Reviewing implementation quality.
- Reviewing security-sensitive changes.
- Deciding when an architectural change is necessary.
- Deciding when a phase is complete.

The Lead / Architect should delegate routine implementation work rather than performing every implementation task directly.

### Implementer

The Implementer is responsible for:

- Implementing the assigned task.
- Following the existing architecture.
- Following the assigned phase specification.
- Writing and running tests.
- Fixing implementation-level failures.
- Reporting exact changes and test results.

The Implementer MUST NOT:

- Redesign the architecture.
- Change public contracts without authorization.
- Expand the scope.
- Start future phases.
- Remove requirements because they are inconvenient.
- Introduce unnecessary dependencies.

When an implementation task conflicts with the architecture, stop and report the conflict.

### Reviewer

The Reviewer is responsible for:

- Verifying acceptance criteria.
- Reviewing the implementation against the specification.
- Checking security constraints.
- Checking regression risks.
- Checking tests and test coverage.
- Checking accidental scope expansion.
- Reviewing public API and adapter contracts.
- Reviewing the final git diff.

The Reviewer may request implementation fixes.

---

## 4. Delegate Implementation Policy

The official implementation delegation path is the local `cmd-delegate` skill.

When a task is suitable for delegated implementation, the Lead / Architect MUST prefer:

```text
cmd-delegate
```

over directly invoking the Command Code CLI.

The skill is responsible for:

- Writing the implementation brief.
- Dispatching the delegated run.
- Polling/waiting for completion.
- Collecting the standardized result.
- Returning touched files, final text, session information, and status.

### Default Implementation Model

The default delegated implementation model is:

```text
xiaomi/mimo-v2.5-pro
```

Use this model for routine implementation work unless escalation is required.

### Lead / Review Model

The Lead / Architect and Reviewer may use:

```text
deepseek/deepseek-v4-pro
```

for:

- Architecture.
- Planning.
- Complex debugging.
- Security analysis.
- Adapter contract design.
- Cross-module refactoring.
- Difficult integration failures.
- Final review of high-risk changes.

Do not use the expensive reasoning model for routine implementation when the delegated implementer is sufficient.

---

## 5. Required Delegation Flow

```text
Lead / Architect
        ↓
Read phase specification
        ↓
Create implementation brief
        ↓
cmd-delegate skill
        ↓
Command Code
        ↓
xiaomi/mimo-v2.5-pro
        ↓
Implement + test
        ↓
Return standardized result
        ↓
Lead / Reviewer
        ↓
Review diff + run project gates
        ↓
Fix if required
        ↓
Commit
```

The delegated implementation process must remain task-scoped.

Do not delegate architecture decisions unless the task explicitly requires them.

---

## 6. Commit Ownership

The delegated implementer MUST NEVER commit.

The Lead / Architect owns the commit boundary.

Only commit after:

1. Reviewing the implementation.
2. Running the required tests.
3. Reviewing the final `git diff`.
4. Confirming the acceptance criteria.
5. Confirming there are no unrelated changes.

Use a phase-specific commit message, for example:

```text
feat: complete phase 03 command-code adapter
```

---

## 7. Mandatory Execution Loop

Always follow:

```text
Read
  ↓
Inspect
  ↓
Plan
  ↓
Delegate / Implement
  ↓
Test
  ↓
Fix
  ↓
Re-test
  ↓
Review
  ↓
Report
```

Never claim a task is complete without actual test execution.

---

## 8. Testing Requirements

Use the appropriate testing level for each change:

- Unit tests for isolated logic.
- Contract tests for adapters and public interfaces.
- Integration tests for service boundaries.
- End-to-end tests for complete workflows.
- Smoke tests for real Harness execution when authentication and credits are available.

When external Harness execution is expensive or unavailable:

- Prefer deterministic fake Harnesses.
- Use fixtures where appropriate.
- Clearly distinguish mocked tests from real Harness tests.

Do not delete or weaken tests to make a phase pass.

---

## 9. Harness Architecture Rule

Harness-specific behavior belongs inside adapters.

The rest of the system must depend on the stable adapter contract, not on individual CLI implementations.

Do not leak:

- CLI flags.
- CLI parsing rules.
- CLI output formats.
- Harness-specific assumptions.

into unrelated parts of the application.

Every Harness integration must be implemented behind the adapter boundary.

---

## 10. LiteLLM Rule

Do not assume that the project must be a LiteLLM fork.

Before making a major LiteLLM decision, evaluate:

1. Dependency usage.
2. Component integration.
3. Selective reuse.
4. Forking.

Choose the smallest approach that satisfies the architecture and requirements.

Do not copy enterprise-only or differently licensed components.

Any licensing-sensitive decision must be documented.

---

## 11. Security Rules

Never:

- Commit credentials.
- Commit API keys.
- Commit Harness login tokens.
- Log authorization headers.
- Log secrets.
- Put secrets into test fixtures.
- Execute unsanitized user input through a shell.
- Use `sh -c` or equivalent for untrusted input.
- Expose sensitive filesystem paths unnecessarily.
- Disable security controls to make tests pass.

Preserve process isolation and least privilege.

---

## 12. Scope Control

The assigned phase is the current scope.

Do not:

- Start the next phase.
- Implement unrelated features.
- Perform unnecessary refactors.
- Replace working architecture without evidence.
- Add dependencies without justification.

Local cleanup is allowed only when it directly supports the assigned task and does not change architecture or public contracts.

---

## 13. Stop Conditions

Stop and report when:

- A requirement is genuinely ambiguous.
- The specification conflicts with the implementation.
- A dependency behaves differently from the documented behavior.
- A Harness changes its CLI/output contract.
- A security issue is discovered.
- A required external service is unavailable.
- A proposed solution requires an architecture change.
- A licensing issue is discovered.

Do not silently invent behavior.

When blocked, provide:

1. The exact issue.
2. Evidence.
3. Impact.
4. Recommended decision.
5. Possible options, when applicable.

---

## 14. Phase Completion Gate

A phase is complete only when:

- All assigned tasks are implemented.
- Acceptance criteria pass.
- Required tests pass.
- Relevant integration tests pass.
- Documentation is updated.
- Security requirements pass.
- No critical TODOs remain.
- The final diff has been reviewed.
- No unrelated changes remain.

Then:

1. Run relevant tests.
2. Run the full suite when practical.
3. Review `git diff`.
4. Update documentation.
5. Commit the phase.

---

## 15. Session Boundary

A new chat/session should normally be started after a completed major phase.

The repository is the long-term project memory.

The new session must continue from:

- Current repository state.
- Git history.
- Project documentation.
- Phase documentation.
- ADRs.
- Test results.

Do not depend on previous chat history.

---

## 16. Session Start Procedure

At the beginning of a new session:

1. Read `AGENT_HANDOFF.md`.
2. Read the current phase documentation.
3. Inspect `git status`.
4. Inspect recent commits.
5. Inspect relevant source files.
6. Continue from the existing repository state.

Do not repeat completed work without evidence that it is missing or broken.

---

## 17. Final Phase Report

At the end of the phase, report:

### Phase Status

`COMPLETE`, `PARTIALLY COMPLETE`, or `BLOCKED`

### Implemented

A concise list of completed work.

### Files Changed

Grouped by purpose.

### Tests

Exact commands and results.

### Acceptance Criteria

Each criterion with:

- PASS
- FAIL
- BLOCKED

### Decisions

Only decisions actually made during the phase.

### Issues

Only unresolved real issues.

### Next Phase

Identify the next phase.

Do not implement the next phase automatically.

### Commit

Provide the recommended commit message.
