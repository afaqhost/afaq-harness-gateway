import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { normalizeOpenCodeEvents, OpenCodeAdapter } from "./opencode.js";
import { ProcessTimedOutError } from "../core/process-runner.js";

const SHIM_PATH = resolve(
  import.meta.dirname,
  "../../testing/fixtures/opencode/opencode-shim.mjs",
);

describe("normalizeOpenCodeEvents", () => {
  it("maps success flow: started, text_delta, usage, completed", () => {
    const events = [
      { type: "step_start", sessionID: "s1" },
      { type: "text", part: { type: "text", text: "Hello." } },
      { type: "step-finish", part: { reason: "stop", tokens: { input: 10, output: 5, cache: { read: 4, write: 0 } }, cost: 0.001 }, sessionID: "s1" },
    ];
    const result = normalizeOpenCodeEvents(events);

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

  it("maps top-level error to a failed event", () => {
    const events = [
      { type: "error", message: "bad request" },
    ];
    const result = normalizeOpenCodeEvents(events);
    expect(result).toEqual([{ type: "failed", message: "bad request", retryable: false }]);
  });

  it("maps step-finish with error reason to a failed event", () => {
    const events = [
      { type: "step-finish", part: { reason: "error" }, sessionID: "s1" },
    ];
    const result = normalizeOpenCodeEvents(events);
    expect(result).toEqual([{ type: "failed", message: "OpenCode run failed", retryable: false }]);
  });

  it("handles missing error.message with string coercion", () => {
    const events = [
      { type: "error" },
    ];
    const result = normalizeOpenCodeEvents(events);
    expect(result[0]).toEqual({ type: "failed", message: "OpenCode run failed", retryable: false });
  });

  it("ignores unrelated event types", () => {
    const events = [
      { type: "lifecycle", action: "start" },
      { type: "tool_call", name: "read" },
      { type: "step-finish", part: { reason: "stop", tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } } } },
    ];
    const result = normalizeOpenCodeEvents(events);
    // Only usage from step-finish (no completed since no finalText)
    expect(result).toEqual([
      { type: "usage", usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, totalTokens: 2, costUsd: undefined } },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeOpenCodeEvents([])).toEqual([]);
  });
});

describe("OpenCodeAdapter", () => {
  it("health() succeeds with the shim's --version", async () => {
    const adapter = new OpenCodeAdapter({ opencodePath: SHIM_PATH });
    const result = await adapter.health();
    expect(result.ok).toBe(true);
  });

  it("health() fails with a nonexistent opencodePath", async () => {
    const adapter = new OpenCodeAdapter({ opencodePath: "/nonexistent/opencode" });
    const result = await adapter.health();
    expect(result.ok).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message!.length).toBeGreaterThan(0);
  });

  it("listModels() returns configured models and defaults", async () => {
    const defaultAdapter = new OpenCodeAdapter();
    const defaults = await defaultAdapter.listModels();
    expect(defaults).toEqual(["opencode/mimo-v2.5-free"]);

    const customAdapter = new OpenCodeAdapter({ models: ["gpt-4o", "gpt-4o-mini"] });
    const custom = await customAdapter.listModels();
    expect(custom).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("listModels() returns a new array (not the internal reference)", async () => {
    const adapter = new OpenCodeAdapter({ models: ["a", "b"] });
    const first = await adapter.listModels();
    const second = await adapter.listModels();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("run() with shim: success path yields started, text_delta, usage, completed", async () => {
    const adapter = new OpenCodeAdapter({ opencodePath: SHIM_PATH });
    const events: unknown[] = [];

    for await (const event of adapter.run({
      runId: "success-test",
      model: "opencode/mimo-v2.5-free",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    })) {
      events.push(event);
    }

    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toEqual(["started", "text_delta", "usage", "completed"]);

    const completed = events.find((e) => (e as { type: string }).type === "completed") as { text: string; sessionId?: string };
    expect(completed.text).toBe("Hello from opencode shim.");
    expect(completed.sessionId).toBe("shim-session-001");
  });

  it("run() with HANG prompt rejects with ProcessTimedOutError and yields zero events", async () => {
    const adapter = new OpenCodeAdapter({ opencodePath: SHIM_PATH });
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
    const adapter = new OpenCodeAdapter({ opencodePath: SHIM_PATH });
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
    expect(failed.message).toBe("OpenCode exited with code 7");
    expect(failed.retryable).toBe(false);

    const completed = events.find((e) => (e as { type: string }).type === "completed");
    expect(completed).toBeUndefined();
  });

  it("run() with RESULT_ERROR prompt yields a failed event", async () => {
    const adapter = new OpenCodeAdapter({ opencodePath: SHIM_PATH });
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
    expect(failed.message).toBe("opencode auth failed");
    expect(failed.retryable).toBe(false);
  });

  it("run() with MALFORMED prompt yields a failed event (jsonl_error path)", async () => {
    const adapter = new OpenCodeAdapter({ opencodePath: SHIM_PATH });
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
    "real smoke test with opencode binary",
    async () => {
      const adapter = new OpenCodeAdapter({ models: ["opencode/mimo-v2.5-free"] });
      const events: unknown[] = [];

      for await (const event of adapter.run({
        runId: "real-smoke",
        model: "opencode/mimo-v2.5-free",
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
