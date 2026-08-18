import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { normalizeCodexEvents, CodexAdapter } from "./codex.js";
import { ProcessTimedOutError } from "../core/process-runner.js";

const SHIM_PATH = resolve(
  import.meta.dirname,
  "../../testing/fixtures/codex/codex-shim.mjs",
);

describe("normalizeCodexEvents", () => {
  it("maps success flow: started, text_delta, usage, completed", () => {
    const events = [
      { type: "thread.started", thread_id: "t1" },
      { type: "turn.started" },
      { type: "item.completed", item: { type: "agent_message", text: "Hello." } },
      { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5 } },
    ];
    const result = normalizeCodexEvents(events);

    expect(result[0]).toEqual({ type: "started", sessionId: "t1" });
    expect(result[1]).toEqual({ type: "text_delta", text: "Hello." });
    expect(result[2]).toEqual({
      type: "usage",
      usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
    });
    expect(result[3]).toEqual({
      type: "completed",
      text: "Hello.",
      sessionId: "t1",
      usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
    });
  });

  it("maps turn.failed to a failed event", () => {
    const events = [
      { type: "turn.failed", error: { message: "something broke" } },
    ];
    const result = normalizeCodexEvents(events);
    expect(result).toEqual([{ type: "failed", message: "something broke", retryable: false }]);
  });

  it("maps top-level error to a failed event", () => {
    const events = [
      { type: "error", message: "bad request" },
    ];
    const result = normalizeCodexEvents(events);
    expect(result).toEqual([{ type: "failed", message: "bad request", retryable: false }]);
  });

  it("handles missing error.message with string coercion", () => {
    const events = [
      { type: "turn.failed", error: {} },
    ];
    const result = normalizeCodexEvents(events);
    expect(result[0]).toEqual({ type: "failed", message: "Codex turn failed", retryable: false });
  });

  it("ignores unrelated event types", () => {
    const events = [
      { type: "turn.started" },
      { type: "thread.updated", thread_id: "t1" },
      { type: "item.created", item: { type: "reasoning", text: "thinking..." } },
      { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ];
    const result = normalizeCodexEvents(events);
    // Only usage from turn.completed (no completed since no finalText)
    expect(result).toEqual([
      { type: "usage", usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 } },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeCodexEvents([])).toEqual([]);
  });

  it("handles multiple agent_message items accumulating last as finalText", () => {
    const events = [
      { type: "thread.started", thread_id: "t2" },
      { type: "item.completed", item: { type: "agent_message", text: "First. " } },
      { type: "item.completed", item: { type: "agent_message", text: "Second." } },
      { type: "turn.completed", usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 3 } },
    ];
    const result = normalizeCodexEvents(events);
    // Two text_deltas
    expect(result.filter((e) => e.type === "text_delta")).toHaveLength(2);
    // Completed uses last finalText
    const completed = result.find((e) => e.type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { text: string }).text).toBe("Second.");
  });
});

describe("CodexAdapter", () => {
  it("health() succeeds with the shim's --version", async () => {
    const adapter = new CodexAdapter({ codexPath: SHIM_PATH });
    const result = await adapter.health();
    expect(result.ok).toBe(true);
  });

  it("health() fails with a nonexistent codexPath", async () => {
    const adapter = new CodexAdapter({ codexPath: "/nonexistent/codex" });
    const result = await adapter.health();
    expect(result.ok).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message!.length).toBeGreaterThan(0);
  });

  it("listModels() returns configured models and defaults", async () => {
    const defaultAdapter = new CodexAdapter();
    const defaults = await defaultAdapter.listModels();
    expect(defaults).toEqual(["gpt-5.6-luna"]);

    const customAdapter = new CodexAdapter({ models: ["gpt-4o", "gpt-4o-mini"] });
    const custom = await customAdapter.listModels();
    expect(custom).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("listModels() returns a new array (not the internal reference)", async () => {
    const adapter = new CodexAdapter({ models: ["a", "b"] });
    const first = await adapter.listModels();
    const second = await adapter.listModels();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("run() with shim: success path yields started, text_delta, usage, completed", async () => {
    const adapter = new CodexAdapter({ codexPath: SHIM_PATH });
    const events: unknown[] = [];

    for await (const event of adapter.run({
      runId: "success-test",
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    })) {
      events.push(event);
    }

    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toEqual(["started", "text_delta", "usage", "completed"]);

    const completed = events.find((e) => (e as { type: string }).type === "completed") as { text: string; sessionId?: string };
    expect(completed.text).toBe("Hello from codex shim.");
    expect(completed.sessionId).toBe("shim-thread-001");
  });

  it("run() with HANG prompt rejects with ProcessTimedOutError and yields zero events", async () => {
    const adapter = new CodexAdapter({ codexPath: SHIM_PATH });
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
    const adapter = new CodexAdapter({ codexPath: SHIM_PATH });
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
    expect(failed.message).toBe("Codex exited with code 7");
    expect(failed.retryable).toBe(false);

    const completed = events.find((e) => (e as { type: string }).type === "completed");
    expect(completed).toBeUndefined();
  });

  it("run() with RESULT_ERROR prompt yields a failed event", async () => {
    const adapter = new CodexAdapter({ codexPath: SHIM_PATH });
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
    expect(failed.message).toBe("codex auth failed");
    expect(failed.retryable).toBe(false);
  });

  it("run() with MALFORMED prompt yields a failed event (jsonl_error path)", async () => {
    const adapter = new CodexAdapter({ codexPath: SHIM_PATH });
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
    "real smoke test with codex binary",
    async () => {
      const adapter = new CodexAdapter({ models: ["gpt-5.6-luna"] });
      const events: unknown[] = [];

      for await (const event of adapter.run({
        runId: "real-smoke",
        model: "gpt-5.6-luna",
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
