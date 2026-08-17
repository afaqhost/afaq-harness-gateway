import { describe, it, expect } from "vitest";
import { formatOpenAIResponse } from "./format-response.js";
import type { HarnessEvent } from "../harness/types.js";

describe("formatOpenAIResponse", () => {
  it("produces correct OpenAI chat.completion shape", () => {
    const events: HarnessEvent[] = [
      { type: "started", sessionId: "s1" },
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { type: "completed", text: "Hello world", sessionId: "s1", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    ];

    const result = formatOpenAIResponse(events, { runId: "run-123", model: "test-model", created: 1700000000 });

    expect(result.object).toBe("chat.completion");
    expect(result.id).toBe("chatcmpl-run-123");
    expect(result.created).toBe(1700000000);
    expect(result.model).toBe("test-model");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].index).toBe(0);
    expect(result.choices[0].message).toEqual({ role: "assistant", content: "Hello world" });
    expect(result.choices[0].finish_reason).toBe("stop");
  });

  it("maps usage fields correctly", () => {
    const events: HarnessEvent[] = [
      { type: "completed", text: "ok", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } },
    ];

    const result = formatOpenAIResponse(events, { runId: "r1", model: "m" });

    expect(result.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
  });

  it("defaults usage to zeros when no usage event present", () => {
    const events: HarnessEvent[] = [
      { type: "text_delta", text: "hello" },
    ];

    const result = formatOpenAIResponse(events, { runId: "r1", model: "m" });

    expect(result.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });

  it("uses completed event text over text_delta", () => {
    const events: HarnessEvent[] = [
      { type: "text_delta", text: "partial" },
      { type: "completed", text: "final answer" },
    ];

    const result = formatOpenAIResponse(events, { runId: "r1", model: "m" });

    expect(result.choices[0].message.content).toBe("final answer");
  });

  it("falls back to accumulated text_delta when no completed event", () => {
    const events: HarnessEvent[] = [
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
    ];

    const result = formatOpenAIResponse(events, { runId: "r1", model: "m" });

    expect(result.choices[0].message.content).toBe("Hello world");
  });

  it("generates a created timestamp when not provided", () => {
    const events: HarnessEvent[] = [
      { type: "completed", text: "ok" },
    ];

    const result = formatOpenAIResponse(events, { runId: "r1", model: "m" });

    expect(result.created).toBeGreaterThan(0);
    expect(typeof result.created).toBe("number");
  });
});
