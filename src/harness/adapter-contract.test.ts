import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import type { HarnessEvent } from "./types.js";
import { CommandCodeAdapter } from "./command-code.js";
import { CodexAdapter } from "./codex.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { OpenCodeAdapter } from "./opencode.js";

const cases = [
  {
    id: "command-code",
    factory: () =>
      new CommandCodeAdapter({
        cmdPath: resolve(import.meta.dirname, "../../testing/fixtures/command-code/cmd-shim.mjs"),
      }),
    model: "deepseek/deepseek-v4-flash",
  },
  {
    id: "codex",
    factory: () =>
      new CodexAdapter({
        codexPath: resolve(import.meta.dirname, "../../testing/fixtures/codex/codex-shim.mjs"),
      }),
    model: "gpt-5.6-luna",
  },
  {
    id: "claude-code",
    factory: () =>
      new ClaudeCodeAdapter({
        claudePath: resolve(import.meta.dirname, "../../testing/fixtures/claude-code/claude-shim.mjs"),
      }),
    model: "claude-sonnet-4-6",
  },
  {
    id: "opencode",
    factory: () =>
      new OpenCodeAdapter({
        opencodePath: resolve(import.meta.dirname, "../../testing/fixtures/opencode/opencode-shim.mjs"),
      }),
    model: "opencode/mimo-v2.5-free",
  },
];

describe("Adapter contract (shared across all harnesses)", () => {
  for (const tc of cases) {
    describe(tc.id, () => {
      const adapter = tc.factory();

      it("adapter.id equals expected id", () => {
        expect(adapter.id).toBe(tc.id);
      });

      it("health() returns { ok: true }", async () => {
        const result = await adapter.health();
        expect(result).toEqual({ ok: true });
      });

      it("listModels() returns a non-empty array", async () => {
        const models = await adapter.listModels();
        expect(models.length).toBeGreaterThan(0);
      });

      it("run() yields a valid HarnessEvent sequence", async () => {
        const events: HarnessEvent[] = [];

        for await (const event of adapter.run({
          runId: `contract-${tc.id}`,
          model: tc.model,
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        })) {
          events.push(event);
        }

        const types = events.map((e) => e.type);

        expect(types).toContain("started");
        expect(types).toContain("text_delta");
        expect(types).toContain("usage");
        expect(types).toContain("completed");

        expect(types.filter((t) => t === "completed")).toHaveLength(1);
        expect(types).not.toContain("failed");

        const startedIdx = types.indexOf("started");
        const completedIdx = types.lastIndexOf("completed");
        expect(startedIdx).toBeLessThan(completedIdx);

        const completed = events[completedIdx] as Extract<HarnessEvent, { type: "completed" }>;
        expect(completed.text.length).toBeGreaterThan(0);
        expect(completed.sessionId).toBeDefined();
      });
    });
  }
});
