import type { HarnessAdapter } from "../harness/types.js";
import type { ContractTestResult } from "./types.js";

export async function runAdapterContractTest(
  adapter: HarnessAdapter,
  model?: string,
): Promise<ContractTestResult> {
  const health = await adapter.health();
  if (!health.ok) {
    return { ok: false, message: `Health check failed: ${health.message ?? "not ok"}` };
  }

  const models = await adapter.listModels();
  if (models.length === 0) {
    return { ok: false, message: "listModels returned empty" };
  }

  const selectedModel = model ?? models[0];

  const events: string[] = [];
  try {
    for await (const event of adapter.run({
      runId: `contract-${Date.now()}`,
      model: selectedModel,
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    })) {
      events.push(event.type);
    }
  } catch (err) {
    return {
      ok: false,
      message: `Run threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (events.includes("failed")) {
    return { ok: false, message: "Run emitted a failed event" };
  }

  if (!events.includes("started")) {
    return { ok: false, message: "Run did not emit a started event" };
  }

  if (!events.includes("text_delta")) {
    return { ok: false, message: "Run did not emit a text_delta event" };
  }

  const completedCount = events.filter((e) => e === "completed").length;
  if (completedCount !== 1) {
    return { ok: false, message: `Expected exactly 1 completed event, got ${completedCount}` };
  }

  return { ok: true };
}
