# LiteLLM Decision Research

## Goal

Determine whether LiteLLM should be:

1. an optional dependency/integration;
2. a source of reusable components;
3. a fork;
4. or not used in the final core.

Do not decide by intuition. Produce evidence.

## Required verification

- Start a known-good LiteLLM proxy container.
- Verify `/v1/models`.
- Verify `/v1/chat/completions`.
- Verify streaming.
- Identify routing and authentication boundaries.
- Identify cost/usage facilities.
- Inspect license files and enterprise-only boundaries in the exact version used.
- Determine whether arbitrary local CLI processes can be integrated cleanly without maintaining a large fork.

## Evaluation criteria

Score 1–5 for:

- implementation speed;
- maintenance burden;
- compatibility with our adapter contract;
- dependency stability;
- licensing clarity;
- ability to keep Afaq core independent.

## Default preference

Prefer **our own small runtime core + selective LiteLLM integration/dependency** over a large fork. A fork is allowed only if a concrete technical benefit outweighs long-term coupling.

## Deliverable

Create `docs/LITELLM_DECISION.md` with one final decision, evidence, tested version, and migration/reversal plan.
