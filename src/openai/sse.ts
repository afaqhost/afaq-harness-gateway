import type { HarnessEvent, Usage } from "../harness/types.js";

export interface SSEChunkOptions {
  runId: string;
  model: string;
  created?: number;
}

export interface SSEChunkUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface SSEChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: [
    {
      index: 0;
      delta: { role?: "assistant"; content?: string };
      finish_reason: "stop" | "length" | null;
    },
  ];
  usage?: SSEChunkUsage;
}

export function mapUsageToOpenAI(usage?: Usage): SSEChunkUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: usage.totalTokens ?? promptTokens + completionTokens,
  };
}

export function formatSSEChunk(
  opts: SSEChunkOptions,
  delta: { role?: "assistant"; content?: string } = {},
  finishReason: "stop" | "length" | null = null,
  usage?: SSEChunkUsage,
): SSEChunk {
  const chunk: SSEChunk = {
    id: `chatcmpl-${opts.runId}`,
    object: "chat.completion.chunk",
    created: opts.created ?? Math.floor(Date.now() / 1000),
    model: opts.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };

  if (usage) chunk.usage = usage;
  return chunk;
}

export function serializeSSE(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export function sseDone(): string {
  return "data: [DONE]\n\n";
}

export function mapHarnessEventToSSEChunks(event: HarnessEvent, opts: SSEChunkOptions): SSEChunk[] {
  switch (event.type) {
    case "started":
      return [formatSSEChunk(opts, { role: "assistant" })];
    case "text_delta":
      return [formatSSEChunk(opts, { content: event.text })];
    case "completed":
      return [formatSSEChunk(opts, {}, "stop", mapUsageToOpenAI(event.usage))];
    case "usage":
      return [formatSSEChunk(opts, {}, null, mapUsageToOpenAI(event.usage))];
    case "failed":
      return [formatSSEChunk(opts, {}, "stop")];
    default:
      return [];
  }
}

export function createSSEStreamMapper(
  opts: SSEChunkOptions,
): (event: HarnessEvent) => string {
  let sentRole = false;
  let pendingUsage: Usage | undefined;
  let finished = false;

  return (event: HarnessEvent): string => {
    if (finished) return "";

    switch (event.type) {
      case "started": {
        if (sentRole) return "";
        sentRole = true;
        return serializeSSE(formatSSEChunk(opts, { role: "assistant" }));
      }
      case "text_delta": {
        const parts: string[] = [];
        if (!sentRole) {
          sentRole = true;
          parts.push(serializeSSE(formatSSEChunk(opts, { role: "assistant" })));
        }
        parts.push(serializeSSE(formatSSEChunk(opts, { content: event.text })));
        return parts.join("");
      }
      case "usage":
        pendingUsage = event.usage;
        return "";
      case "completed":
        finished = true;
        return serializeSSE(
          formatSSEChunk(opts, {}, "stop", mapUsageToOpenAI(event.usage ?? pendingUsage)),
        );
      case "failed":
        finished = true;
        return serializeSSE(formatSSEChunk(opts, {}, "stop"));
      default:
        return "";
    }
  };
}
