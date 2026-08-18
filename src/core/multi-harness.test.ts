import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { AdapterRegistry } from "./adapter-registry.js";
import { RunService } from "./run-service.js";
import { RunStore } from "./store.js";
import { CommandCodeAdapter } from "../harness/command-code.js";
import { CodexAdapter } from "../harness/codex.js";
import { ClaudeCodeAdapter } from "../harness/claude-code.js";
import { OpenCodeAdapter } from "../harness/opencode.js";

const FIXTURES = resolve(import.meta.dirname, "../../testing/fixtures");

function buildRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(
    new CommandCodeAdapter({ cmdPath: resolve(FIXTURES, "command-code/cmd-shim.mjs") }),
  );
  registry.register(
    new CodexAdapter({ codexPath: resolve(FIXTURES, "codex/codex-shim.mjs") }),
  );
  registry.register(
    new ClaudeCodeAdapter({ claudePath: resolve(FIXTURES, "claude-code/claude-shim.mjs") }),
  );
  registry.register(
    new OpenCodeAdapter({ opencodePath: resolve(FIXTURES, "opencode/opencode-shim.mjs") }),
  );
  return registry;
}

const routingTable: Array<{ model: string; expectedHarness: string }> = [
  { model: "command-code/deepseek/deepseek-v4-flash", expectedHarness: "command-code" },
  { model: "codex/gpt-5.6-luna", expectedHarness: "codex" },
  { model: "claude-code/claude-sonnet-4-6", expectedHarness: "claude-code" },
  { model: "opencode/opencode/mimo-v2.5-free", expectedHarness: "opencode" },
];

describe("Multi-harness routing stability", () => {
  const registry = buildRegistry();
  const store = new RunStore(":memory:");
  const runService = new RunService({
    adapterRegistry: registry,
    store,
    defaultTimeoutMs: 30_000,
  });

  it("registry.ids() contains all four adapter ids", () => {
    expect(registry.ids().sort()).toEqual([
      "claude-code",
      "codex",
      "command-code",
      "opencode",
    ]);
  });

  for (const tc of routingTable) {
    it(`routes "${tc.model}" to harness "${tc.expectedHarness}"`, async () => {
      const result = await runService.run({
        model: tc.model,
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.status).toBe("completed");
      if (result.status !== "completed") throw new TypeError("unreachable");

      const row = store.getRun(result.runId);
      expect(row).toBeDefined();
      expect(row!.harness).toBe(tc.expectedHarness);

      const completed = result.events.find((e) => e.type === "completed") as
        | { type: "completed"; text: string }
        | undefined;
      expect(completed).toBeDefined();
      expect(completed!.text.length).toBeGreaterThan(0);
    });
  }
});
