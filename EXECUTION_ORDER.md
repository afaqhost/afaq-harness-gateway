# Execution Order

Follow phases strictly in this order.

1. `00-foundation` — repository rules, definition of done, test baseline.
2. `01-research` — verify LiteLLM boundaries and actual harness CLI behavior.
3. `02-poc` — prove OpenAI-compatible request -> local CLI -> normalized response.
4. `03-core` — build the independent runtime and adapter contract.
5. `04-command-code` — production-quality Command-Code adapter.
6. `05-streaming-chat` — SSE streaming and internal Chat UI.
7. `06-auth-usage` — API keys, usage, estimated cost, limits.
8. `07-hermes` — Hermes integration and end-to-end verification.
9. `08-adapters` — Codex, Claude Code, OpenCode.
10. `09-hardening` — security, reliability, cancellation, retention, observability.
11. `10-release` — packaging, licensing, docs, contribution workflow.

Do not skip a phase because a later feature appears easy. The phase order is designed to minimize rework.
