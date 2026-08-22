# Reliability Hardening

## Queue

Start with an in-process queue.

- global concurrency: 1–2 by default;
- per-key concurrency: 1 by default;
- bounded queue size;
- queue timeout;
- run timeout.

## Cancellation

- map each `runId` to its child process;
- send SIGTERM first;
- after a grace period, use SIGKILL if required;
- persist `cancelled` state;
- close SSE cleanly.

## Observability

Structured logs should include:

- request ID;
- run ID;
- key ID, never the secret;
- harness;
- model;
- status;
- duration;
- error code.

Do not persist full raw tool output by default.
