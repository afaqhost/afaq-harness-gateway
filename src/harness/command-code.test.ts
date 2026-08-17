import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { normalizeCcEvents, serializeMessages, mapCcExitCode, CommandCodeAdapter } from "./command-code.js";
import { parseNdjson } from "./jsonl.js";
import { Readable } from "node:stream";
import { ProcessTimedOutError, ProcessCancelledError } from "../core/process-runner.js";

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "../../01-research/fixtures/command-code/headless-run.ndjson",
);

const SHIM_PATH = resolve(
  import.meta.dirname,
  "../../testing/fixtures/command-code/cmd-shim.mjs",
);

const TOOL_EVENTS_FIXTURE = resolve(
  import.meta.dirname,
  "../../testing/fixtures/command-code/tool-events.ndjson",
);

const CLI_ERROR_FIXTURE = resolve(
  import.meta.dirname,
  "../../testing/fixtures/command-code/cli-error.ndjson",
);

async function parseFixture(path: string) {
  const raw = readFileSync(path, "utf-8");
  const events: Record<string, unknown>[] = [];
  for await (const obj of parseNdjson(Readable.from(Buffer.from(raw)))) {
    events.push(obj);
  }
  return events;
}

describe("serializeMessages", () => {
  it("produces deterministic output", () => {
    const result = serializeMessages([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ]);
    expect(result).toBe("[system]\nYou are helpful.\n\n[user]\nHello");
  });

  it("returns the same output for the same input", () => {
    const msgs = [{ role: "user" as const, content: "test" }];
    expect(serializeMessages(msgs)).toBe(serializeMessages(msgs));
  });
});

describe("mapCcExitCode", () => {
  const cases: [number, string, boolean][] = [
    [3, "Command-Code authentication error.", false],
    [4, "Command-Code permission error.", false],
    [5, "Command-Code rate limit exceeded.", true],
    [6, "Command-Code network error.", true],
    [7, "Command-Code upstream server error.", true],
    [8, "Command-Code max turns reached.", false],
    [9, "Command-Code no response.", false],
    [10, "Command-Code insufficient credits.", false],
    [130, "Command-Code interrupted.", false],
    [1, "Command-Code exited with code 1.", false],
    [99, "Command-Code exited with code 99.", false],
  ];

  for (const [code, expectedMsg, expectedRetryable] of cases) {
    it(`exit code ${code} -> retryable:${expectedRetryable}`, () => {
      const result = mapCcExitCode(code);
      expect(result.message).toBe(expectedMsg);
      expect(result.retryable).toBe(expectedRetryable);
    });
  }
});

describe("normalizeCcEvents", () => {
  it("produces started, text_delta, usage, and completed from the captured fixture", async () => {
    const ccEvents = await parseFixture(FIXTURE_PATH);
    const events = normalizeCcEvents(ccEvents as Parameters<typeof normalizeCcEvents>[0]);

    expect(events.length).toBeGreaterThanOrEqual(3);

    const started = events.find((e) => e.type === "started");
    expect(started).toBeDefined();
    expect((started as { sessionId?: string }).sessionId).toBe("a20cf574-fcb0-4ae0-91d1-91ab10eac36f");

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThanOrEqual(1);
    const fullText = textDeltas.map((e) => (e as { text: string }).text).join("");
    expect(fullText).toContain("VERIFIED");

    const completed = events.find((e) => e.type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { text: string }).text).toBe("VERIFIED");
    expect((completed as { sessionId?: string }).sessionId).toBe("a20cf574-fcb0-4ae0-91d1-91ab10eac36f");

    const usage = events.find((e) => e.type === "usage");
    expect(usage).toBeDefined();
    expect((usage as { usage: { inputTokens: number } }).usage.inputTokens).toBe(16571);
    expect((usage as { usage: { outputTokens: number } }).usage.outputTokens).toBe(15);
  });

  it("filters out all thinking_* events", async () => {
    const ccEvents = await parseFixture(FIXTURE_PATH);
    const events = normalizeCcEvents(ccEvents as Parameters<typeof normalizeCcEvents>[0]);
    const thinkingEvents = events.filter((e) => e.type.startsWith("thinking"));
    expect(thinkingEvents).toEqual([]);
  });

  it("maps usage fields correctly including cacheReadTokens", async () => {
    const ccEvents = await parseFixture(FIXTURE_PATH);
    const events = normalizeCcEvents(ccEvents as Parameters<typeof normalizeCcEvents>[0]);
    const usageEvent = events.find((e) => e.type === "usage");
    expect(usageEvent).toBeDefined();
    const u = (usageEvent as { usage: Record<string, number | undefined> }).usage;
    expect(u.inputTokens).toBe(16571);
    expect(u.outputTokens).toBe(15);
    expect(u.cachedInputTokens).toBe(5376);
    expect(u.totalTokens).toBe(16586);
  });

  it("extracts sessionId from run_start", async () => {
    const ccEvents: Parameters<typeof normalizeCcEvents>[0] = [
      { type: "event", event: { type: "run_start", sessionId: "test-session" } },
      { type: "event", event: { type: "text_delta", delta: "hi" } },
      { type: "result", subtype: "success", sessionId: "test-session", finalText: "hi", usage: { inputTokens: 1, outputTokens: 1 } },
    ];

    const events = normalizeCcEvents(ccEvents);
    expect(events[0]).toEqual({ type: "started", sessionId: "test-session" });
  });

  it("emits tool_started and tool_finished from tool-events.ndjson", async () => {
    const ccEvents = await parseFixture(TOOL_EVENTS_FIXTURE);
    const events = normalizeCcEvents(ccEvents as Parameters<typeof normalizeCcEvents>[0]);

    const toolStarted = events.filter((e) => e.type === "tool_started");
    expect(toolStarted).toHaveLength(1);
    expect(toolStarted[0]).toEqual({ type: "tool_started", tool: "read_file" });

    const toolFinished = events.filter((e) => e.type === "tool_finished");
    expect(toolFinished).toHaveLength(2);
    expect(toolFinished[0]).toEqual({ type: "tool_finished", tool: "read_file", output: "file contents here", success: true });
    expect(toolFinished[1]).toEqual({ type: "tool_finished", tool: "write_file", output: "Permission denied", success: false });

    const completed = events.find((e) => e.type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { text: string }).text).toBe("done");
  });

  it("maps cli-error.ndjson to a failed event", async () => {
    const ccEvents = await parseFixture(CLI_ERROR_FIXTURE);
    const events = normalizeCcEvents(ccEvents as Parameters<typeof normalizeCcEvents>[0]);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "failed", message: "Command-Code authentication failed", retryable: false });
  });
});

describe("CommandCodeAdapter", () => {
  it("health() succeeds with the shim's --version", async () => {
    const adapter = new CommandCodeAdapter({ cmdPath: SHIM_PATH });
    const result = await adapter.health();
    expect(result.ok).toBe(true);
  });

  it("health() fails with a nonexistent cmdPath", async () => {
    const adapter = new CommandCodeAdapter({ cmdPath: "/nonexistent/cmd" });
    const result = await adapter.health();
    expect(result.ok).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message!.length).toBeGreaterThan(0);
  });

  it("listModels() returns configured models and defaults", async () => {
    const defaultAdapter = new CommandCodeAdapter();
    const defaults = await defaultAdapter.listModels();
    expect(defaults).toEqual(["deepseek/deepseek-v4-flash"]);

    const customAdapter = new CommandCodeAdapter({ models: ["gpt-4", "gpt-3.5-turbo"] });
    const custom = await customAdapter.listModels();
    expect(custom).toEqual(["gpt-4", "gpt-3.5-turbo"]);
  });

  it("listModels() returns a new array (not the internal reference)", async () => {
    const adapter = new CommandCodeAdapter({ models: ["a", "b"] });
    const first = await adapter.listModels();
    const second = await adapter.listModels();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("run() with HANG prompt rejects with ProcessTimedOutError and yields zero events", async () => {
    const adapter = new CommandCodeAdapter({ cmdPath: SHIM_PATH });
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

  it("run() with TOOL_EVENTS prompt yields tool_started and tool_finished before completed", async () => {
    const adapter = new CommandCodeAdapter({ cmdPath: SHIM_PATH });
    const events: unknown[] = [];

    for await (const event of adapter.run({
      runId: "tool-test",
      model: "test",
      messages: [{ role: "user", content: "TOOL_EVENTS test" }],
      stream: false,
    })) {
      events.push(event);
    }

    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain("tool_started");
    expect(types).toContain("tool_finished");

    const toolStartIdx = types.indexOf("tool_started");
    const toolFinishIdx = types.indexOf("tool_finished");
    const completedIdx = types.indexOf("completed");
    expect(toolStartIdx).toBeLessThan(completedIdx);
    expect(toolFinishIdx).toBeLessThan(completedIdx);
  });

  it("run() with NONZERO prompt yields a failed event with retryable:true and no completed", async () => {
    const adapter = new CommandCodeAdapter({ cmdPath: SHIM_PATH });
    const events: unknown[] = [];

    for await (const event of adapter.run({
      runId: "nonzero-test",
      model: "test",
      messages: [{ role: "user", content: "NONZERO test" }],
      stream: false,
    })) {
      events.push(event);
    }

    const failed = events.find((e) => (e as { type: string }).type === "failed") as { type: string; message: string; retryable: boolean } | undefined;
    expect(failed).toBeDefined();
    expect(failed!.message).toContain("upstream server");
    expect(failed!.retryable).toBe(true);

    const completed = events.find((e) => (e as { type: string }).type === "completed");
    expect(completed).toBeUndefined();
  });

  it("run() with RESULT_ERROR prompt yields a failed event from the error result frame", async () => {
    const adapter = new CommandCodeAdapter({ cmdPath: SHIM_PATH });
    const events: unknown[] = [];

    for await (const event of adapter.run({
      runId: "result-error-test",
      model: "test",
      messages: [{ role: "user", content: "RESULT_ERROR test" }],
      stream: false,
    })) {
      events.push(event);
    }

    const failed = events.find((e) => (e as { type: string }).type === "failed") as { type: string; message: string; retryable: boolean } | undefined;
    expect(failed).toBeDefined();
    expect(failed!.message).toBe("Command-Code authentication failed");
    expect(failed!.retryable).toBe(false);
  });
});
