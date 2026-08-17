import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeCcEvents } from "./command-code.js";
import { parseNdjson } from "./jsonl.js";
import { Readable } from "node:stream";

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "../../01-research/fixtures/command-code/headless-run.ndjson",
);

describe("normalizeCcEvents", () => {
  it("produces started, text_delta, usage, and completed from the captured fixture", async () => {
    const raw = readFileSync(FIXTURE_PATH, "utf-8");
    const ccEvents: Record<string, unknown>[] = [];
    for await (const obj of parseNdjson(Readable.from(Buffer.from(raw)))) {
      ccEvents.push(obj);
    }

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
    const raw = readFileSync(FIXTURE_PATH, "utf-8");
    const ccEvents: Record<string, unknown>[] = [];
    for await (const obj of parseNdjson(Readable.from(Buffer.from(raw)))) {
      ccEvents.push(obj);
    }

    const events = normalizeCcEvents(ccEvents as Parameters<typeof normalizeCcEvents>[0]);
    const thinkingEvents = events.filter((e) => e.type.startsWith("thinking"));
    expect(thinkingEvents).toEqual([]);
  });

  it("maps usage fields correctly including cacheReadTokens", async () => {
    const raw = readFileSync(FIXTURE_PATH, "utf-8");
    const ccEvents: Record<string, unknown>[] = [];
    for await (const obj of parseNdjson(Readable.from(Buffer.from(raw)))) {
      ccEvents.push(obj);
    }

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
});
