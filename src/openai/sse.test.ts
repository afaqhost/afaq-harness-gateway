import { describe, it, expect } from "vitest";
import {
  formatSSEChunk,
  serializeSSE,
  sseDone,
  mapUsageToOpenAI,
  mapHarnessEventToSSEChunks,
  createSSEStreamMapper,
} from "./sse.js";
import type { HarnessEvent } from "../harness/types.js";

const opts = { runId: "run-123", model: "fake-harness/fake-model", created: 1700000000 };

describe("formatSSEChunk", () => {
  it("produces the OpenAI chat.completion.chunk shape", () => {
    const chunk = formatSSEChunk(opts, { role: "assistant" });
    expect(chunk).toEqual({
      id: "chatcmpl-run-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "fake-harness/fake-model",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });
  });

  it("attaches usage only when provided", () => {
    const chunk = formatSSEChunk(opts, {}, "stop", { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
    expect(chunk.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
    expect(formatSSEChunk(opts).usage).toBeUndefined();
  });
});

describe("serializeSSE", () => {
  it("wraps JSON as an SSE data frame", () => {
    expect(serializeSSE({ hello: "world" })).toBe('data: {"hello":"world"}\n\n');
  });

  it("emits the [DONE] terminator", () => {
    expect(sseDone()).toBe("data: [DONE]\n\n");
  });
});

describe("mapUsageToOpenAI", () => {
  it("maps token fields and derives total when missing", () => {
    expect(mapUsageToOpenAI({ inputTokens: 4, outputTokens: 3 })).toEqual({
      prompt_tokens: 4,
      completion_tokens: 3,
      total_tokens: 7,
    });
    expect(mapUsageToOpenAI(undefined)).toBeUndefined();
  });
});

describe("mapHarnessEventToSSEChunks", () => {
  it("maps started to an assistant role delta", () => {
    const event: HarnessEvent = { type: "started", sessionId: "s1" };
    const chunks = mapHarnessEventToSSEChunks(event, opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta).toEqual({ role: "assistant" });
  });

  it("maps text_delta to a content delta", () => {
    const event: HarnessEvent = { type: "text_delta", text: "hi" };
    const chunks = mapHarnessEventToSSEChunks(event, opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta).toEqual({ content: "hi" });
  });

  it("maps completed to a terminal chunk with usage", () => {
    const event: HarnessEvent = {
      type: "completed",
      text: "done",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
    const chunks = mapHarnessEventToSSEChunks(event, opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].finish_reason).toBe("stop");
    expect(chunks[0].usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it("does not leak harness internals from failed events", () => {
    const event: HarnessEvent = {
      type: "failed",
      message: "CLI exploded at /secret/path with token abc123",
      retryable: false,
    };
    const chunks = mapHarnessEventToSSEChunks(event, opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].finish_reason).toBe("stop");
    expect(JSON.stringify(chunks)).not.toContain("CLI exploded");
    expect(JSON.stringify(chunks)).not.toContain("/secret/path");
    expect(JSON.stringify(chunks)).not.toContain("abc123");
  });

  it("maps a mid-stream usage event to a non-terminal chunk", () => {
    const event: HarnessEvent = {
      type: "usage",
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    };
    const chunks = mapHarnessEventToSSEChunks(event, opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].finish_reason).toBeNull();
    expect(chunks[0].usage).toEqual({ prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
  });

  it("drops tool events", () => {
    expect(mapHarnessEventToSSEChunks({ type: "tool_started", tool: "x" }, opts)).toEqual([]);
    expect(mapHarnessEventToSSEChunks({ type: "tool_finished", tool: "x", output: "o", success: true }, opts)).toEqual([]);
  });
});

describe("createSSEStreamMapper", () => {
  it("emits exactly one role delta, content deltas, a usage-bearing final chunk, and no duplicates after completion", () => {
    const map = createSSEStreamMapper(opts);
    const output = [
      map({ type: "started", sessionId: "s1" }),
      map({ type: "text_delta", text: "Hello " }),
      map({ type: "text_delta", text: "world" }),
      map({ type: "usage", usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 } }),
      map({ type: "completed", text: "Hello world" }),
      map({ type: "text_delta", text: "late" }),
    ].join("");

    expect(output).toContain('"delta":{"role":"assistant"}');
    expect(output).toContain('"delta":{"content":"Hello "}');
    expect(output).toContain('"delta":{"content":"world"}');
    expect(output).toContain('"finish_reason":"stop"');
    expect(output).toContain('"prompt_tokens":2');
    expect(output).not.toContain("late");

    const roleCount = output.split('"role":"assistant"').length - 1;
    expect(roleCount).toBe(1);
  });

  it("emits the role delta before the first content delta even without a started event", () => {
    const map = createSSEStreamMapper(opts);
    const output = map({ type: "text_delta", text: "x" });
    expect(output).toContain('"role":"assistant"');
    expect(output).toContain('"content":"x"');
  });

  it("falls back to a pending usage event when completed has no usage", () => {
    const map = createSSEStreamMapper(opts);
    map({ type: "usage", usage: { inputTokens: 9, outputTokens: 1, totalTokens: 10 } });
    const output = map({ type: "completed", text: "ok" });
    expect(output).toContain('"prompt_tokens":9');
    expect(output).toContain('"completion_tokens":1');
  });
});
