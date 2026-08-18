import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { normalizeClaudeCodeEvents, ClaudeCodeAdapter } from "./claude-code.js";
import { ProcessTimedOutError } from "../core/process-runner.js";

const SHIM_PATH = resolve(
  import.meta.dirname,
  "../../testing/fixtures/claude-code/claude-shim.mjs",
);

describe("normalizeClaudeCodeEvents", () => {
  it("maps success flow: started, text_delta, usage, completed", () => {
    const events = [
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "assistant", message: { content: [{ type: "text", text: "Hello." }] } },
      {
        type: "result",
        subtype: "success",
        result: "Hello.",
        session_id: "s1",
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 0 },
        total_cost_usd: 0.001,
      },
    ];
    const result = normalizeClaudeCodeEvents(events);

    expect(result[0]).toEqual({ type: "started", sessionId: "s1" });
    expect(result[1]).toEqual({ type: "text_delta", text: "Hello." });
    expect(result[2]).toEqual({
      type: "usage",
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, cacheWriteTokens: 0, totalTokens: 15, costUsd: 0.001 },
    });
    expect(result[3]).toEqual({
      type: "completed",
      text: "Hello.",
      sessionId: "s1",
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, cacheWriteTokens: 0, totalTokens: 15, costUsd: 0.001 },
    });
  });

  it("maps result error subtype to a failed event", () => {
    const events = [
      { type: "result", subtype: "error_during_execution", error: "something broke" },
    ];
    const result = normalizeClaudeCodeEvents(events);
    expect(result).toEqual([{ type: "failed", message: "something broke", retryable: false }]);
  });

  it("maps result error_max_turns to a failed event", () => {
    const events = [
      { type: "result", subtype: "error_max_turns", result: "too many turns" },
    ];
    const result = normalizeClaudeCodeEvents(events);
    expect(result).toEqual([{ type: "failed", message: "too many turns", retryable: false }]);
  });

  it("maps top-level error to a failed event", () => {
    const events = [
      { type: "error", error: "bad request" },
    ];
    const result = normalizeClaudeCodeEvents(events);
    expect(result).toEqual([{ type: "failed", message: "bad request", retryable: false }]);
  });

  it("handles missing error fields with string coercion", () => {
    const events = [
      { type: "result", subtype: "error_during_execution" },
    ];
    const result = normalizeClaudeCodeEvents(events);
    expect(result[0]).toEqual({ type: "failed", message: "Claude Code run failed", retryable: false });
  });

  it("ignores unrelated event types", () => {
    const events = [
      { type: "system", subtype: "heartbeat" },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "read" }] } },
    ];
    const result = normalizeClaudeCodeEvents(events);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeClaudeCodeEvents([])).toEqual([]);
  });

  it("stream_event text_delta takes precedence over assistant fallback", () => {
    const events = [
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "streamed." } } },
      { type: "assistant", message: { content: [{ type: "text", text: "fallback." }] } },
    ];
    const result = normalizeClaudeCodeEvents(events);
    // Only the stream_event text_delta, assistant is skipped because hasStreamText=true
    const deltas = result.filter((e) => e.type === "text_delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual({ type: "text_delta", text: "streamed." });
  });
});

describe("ClaudeCodeAdapter", () => {
  it("health() succeeds with the shim's --version", async () => {
    const adapter = new ClaudeCodeAdapter({ claudePath: SHIM_PATH });
    const result = await adapter.health();
    expect(result.ok).toBe(true);
  });

  it("health() fails with a nonexistent claudePath", async () => {
    const adapter = new ClaudeCodeAdapter({ claudePath: "/nonexistent/claude" });
    const result = await adapter.health();
    expect(result.ok).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message!.length).toBeGreaterThan(0);
  });

  it("listModels() returns configured models and defaults", async () => {
    const defaultAdapter = new ClaudeCodeAdapter();
    const defaults = await defaultAdapter.listModels();
    expect(defaults).toEqual(["claude-sonnet-4-6"]);

    const customAdapter = new ClaudeCodeAdapter({ models: ["claude-opus-4-6", "claude-haiku-4-5"] });
    const custom = await customAdapter.listModels();
    expect(custom).toEqual(["claude-opus-4-6", "claude-haiku-4-5"]);
  });

  it("listModels() returns a new array (not the internal reference)", async () => {
    const adapter = new ClaudeCodeAdapter({ models: ["a", "b"] });
    const first = await adapter.listModels();
    const second = await adapter.listModels();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("run() with shim: success path yields started, text_delta, usage, completed", async () => {
    const adapter = new ClaudeCodeAdapter({ claudePath: SHIM_PATH });
    const events: unknown[] = [];

    for await (const event of adapter.run({
      runId: "success-test",
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    })) {
      events.push(event);
    }

    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toEqual(["started", "text_delta", "usage", "completed"]);

    const completed = events.find((e) => (e as { type: string }).type === "completed") as { text: string; sessionId?: string };
    expect(completed.text).toBe("Hello from claude shim.");
    expect(completed.sessionId).toBe("shim-session-001");
  });

  it("run() with HANG prompt rejects with ProcessTimedOutError and yields zero events", async () => {
    const adapter = new ClaudeCodeAdapter({ claudePath: SHIM_PATH });
    const events: unknown[] = [];
    let error: unknown;

    try {
      for await (const event of adapter.run({
        runId: "hang-test",
        model: "test",
        messages: [{ role: "user", content: "HANG forever" }],
        stream: false,
        timeoutMs: 500,
      })) {
        events.push(event);
      }
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ProcessTimedOutError);
    expect(events).toHaveLength(0);
  });

  it("run() with NONZERO prompt yields failed event with retryable:false and no completed", async () => {
    const adapter = new ClaudeCodeAdapter({ claudePath: SHIM_PATH });
    const events: unknown[] = [];

    for await (const event of adapter.run({
      runId: "nonzero-test",
      model: "test",
      messages: [{ role: "user", content: "NONZERO test" }],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    const failed = events[0] as { type: string; message: string; retryable: boolean };
    expect(failed.type).toBe("failed");
    expect(failed.message).toBe("Claude Code exited with code 7");
    expect(failed.retryable).toBe(false);

    const completed = events.find((e) => (e as { type: string }).type === "completed");
    expect(completed).toBeUndefined();
  });

  it("run() with RESULT_ERROR prompt yields a failed event", async () => {
    const adapter = new ClaudeCodeAdapter({ claudePath: SHIM_PATH });
    const events: unknown[] = [];

    for await (const event of adapter.run({
      runId: "result-error-test",
      model: "test",
      messages: [{ role: "user", content: "RESULT_ERROR test" }],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    const failed = events[0] as { type: string; message: string; retryable: boolean };
    expect(failed.type).toBe("failed");
    expect(failed.message).toBe("claude auth failed");
    expect(failed.retryable).toBe(false);
  });

  it("run() with MALFORMED prompt yields a failed event (jsonl_error path)", async () => {
    const adapter = new ClaudeCodeAdapter({ claudePath: SHIM_PATH });
    const events: unknown[] = [];

    for await (const event of adapter.run({
      runId: "malformed-test",
      model: "test",
      messages: [{ role: "user", content: "MALFORMED test" }],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    const failed = events[0] as { type: string; message: string; retryable: boolean };
    expect(failed.type).toBe("failed");
    expect(failed.retryable).toBe(false);
    expect(failed.message).toContain("Failed to parse JSONL");
  });

  it.skipIf(!process.env.RUN_REAL_HARNESS)(
    "real smoke test with claude binary",
    async () => {
      const adapter = new ClaudeCodeAdapter({ models: ["claude-sonnet-4-6"] });
      const events: unknown[] = [];

      for await (const event of adapter.run({
        runId: "real-smoke",
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "Reply with exactly: VERIFIED" }],
        stream: false,
        timeoutMs: 60_000,
      })) {
        events.push(event);
      }

      const completed = events.find((e) => (e as { type: string }).type === "completed") as { text: string } | undefined;
      expect(completed).toBeDefined();
      expect(completed!.text).toContain("VERIFIED");
    },
    70_000,
  );
});
