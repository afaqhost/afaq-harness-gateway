# ADR-002 — LiteLLM Strategy

## Decision

Do not make a large LiteLLM fork the default architecture.

First prove the required behavior with a POC. Prefer a clean Afaq runtime core and use LiteLLM selectively where it provides clear value without excessive coupling.

A fork is justified only by measurable technical benefits and verified licensing boundaries.

## Consequence

Afaq must keep its own adapter contract and core services independent of LiteLLM internals.
