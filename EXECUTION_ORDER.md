# Execution Order — Phase 10 to Release

Run one phase at a time:

```text
10 → 11 → 12 → 13 → 14 → 15
```

For every phase:

1. Read `AGENT_HANDOFF.md`.
2. Read the phase README and checklist.
3. Inspect `git status` and recent commits.
4. Preserve the existing architecture unless the phase explicitly changes it.
5. Use `cmd-delegate` for routine implementation tasks.
6. Run tests continuously.
7. Review the final diff.
8. Update documentation.
9. Commit the completed phase.
10. Start a new session for the next major phase.

Never start the next phase automatically.

## Dependency order

- Phase 10 defines the platform model.
- Phase 11 depends on the platform model and adds installation/discovery.
- Phase 12 depends on installations and adds credentials/lifecycle.
- Phase 13 depends on installed versions and adapter compatibility.
- Phase 14 depends on stable lifecycle and credential boundaries.
- Phase 15 depends on the previous phases.

## Non-goals

Do not introduce a provider-subscription resale model, billing system, marketplace, Kubernetes, multi-region infrastructure, Redis, or PostgreSQL unless a later explicitly approved scope requires them.
