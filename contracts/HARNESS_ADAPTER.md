# Harness Adapter Contract

```ts
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type HarnessRunRequest = {
  runId: string;
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  maxTurns?: number;
  timeoutMs?: number;
};

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  costUsd?: number;
};

export type HarnessEvent =
  | { type: "started"; sessionId?: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; tool: string; input?: unknown }
  | { type: "tool_finished"; tool: string; output?: string; success: boolean }
  | { type: "usage"; usage: Usage }
  | { type: "completed"; text: string; sessionId?: string; usage?: Usage }
  | { type: "failed"; message: string; retryable?: boolean };

export interface HarnessAdapter {
  id: string;
  health(): Promise<{ ok: boolean; message?: string }>;
  listModels(): Promise<string[]>;
  run(request: HarnessRunRequest): AsyncGenerator<HarnessEvent>;
  cancel(runId: string): Promise<void>;
}
```

## Responsibilities

An adapter must:

- verify the CLI exists;
- construct safe CLI arguments;
- serialize messages when native chat input is unavailable;
- spawn without a shell;
- parse stdout incrementally;
- keep stderr for diagnostics;
- enforce timeouts;
- cancel child processes;
- normalize events;
- extract final text, session ID, and usage when available.

The adapter must not own HTTP routing, API-key authentication, persistent Chat history, or global queue policy.
