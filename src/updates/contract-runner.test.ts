import { describe, it, expect } from "vitest";
import { runAdapterContractTest } from "./contract-runner.js";
import type { HarnessAdapter, HarnessEvent } from "../harness/types.js";

function makeAdapter(overrides: Partial<HarnessAdapter> = {}): HarnessAdapter {
  return {
    id: "test-adapter",
    async health() {
      return { ok: true };
    },
    async listModels() {
      return ["test-model"];
    },
    async *run(): AsyncGenerator<HarnessEvent> {
      yield { type: "started" };
      yield { type: "text_delta", text: "Hello" };
      yield { type: "completed", text: "Hello" };
    },
    async cancel() {},
    ...overrides,
  };
}

describe("runAdapterContractTest", () => {
  it("passes for a healthy adapter with correct event sequence", async () => {
    const result = await runAdapterContractTest(makeAdapter());
    expect(result.ok).toBe(true);
  });

  it("fails when health check fails", async () => {
    const adapter = makeAdapter({
      async health() {
        return { ok: false, message: "unhealthy" };
      },
    });
    const result = await runAdapterContractTest(adapter);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Health check failed");
  });

  it("fails when listModels returns empty", async () => {
    const adapter = makeAdapter({
      async listModels() {
        return [];
      },
    });
    const result = await runAdapterContractTest(adapter);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("empty");
  });

  it("fails when run emits a failed event", async () => {
    const adapter = makeAdapter({
      async *run(): AsyncGenerator<HarnessEvent> {
        yield { type: "started" };
        yield { type: "failed", message: "boom" };
      },
    });
    const result = await runAdapterContractTest(adapter);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });

  it("fails when run does not emit started", async () => {
    const adapter = makeAdapter({
      async *run(): AsyncGenerator<HarnessEvent> {
        yield { type: "text_delta", text: "hi" };
        yield { type: "completed", text: "hi" };
      },
    });
    const result = await runAdapterContractTest(adapter);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("started");
  });

  it("fails when run does not emit text_delta", async () => {
    const adapter = makeAdapter({
      async *run(): AsyncGenerator<HarnessEvent> {
        yield { type: "started" };
        yield { type: "completed", text: "hi" };
      },
    });
    const result = await runAdapterContractTest(adapter);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("text_delta");
  });

  it("fails when run has no completed event", async () => {
    const adapter = makeAdapter({
      async *run(): AsyncGenerator<HarnessEvent> {
        yield { type: "started" };
        yield { type: "text_delta", text: "hi" };
      },
    });
    const result = await runAdapterContractTest(adapter);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("completed");
  });

  it("fails when run has multiple completed events", async () => {
    const adapter = makeAdapter({
      async *run(): AsyncGenerator<HarnessEvent> {
        yield { type: "started" };
        yield { type: "text_delta", text: "hi" };
        yield { type: "completed", text: "first" };
        yield { type: "completed", text: "second" };
      },
    });
    const result = await runAdapterContractTest(adapter);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("exactly 1");
  });

  it("uses provided model over first listed", async () => {
    let capturedModel = "";
    const adapter = makeAdapter({
      async *run(request): AsyncGenerator<HarnessEvent> {
        capturedModel = request.model;
        yield { type: "started" };
        yield { type: "text_delta", text: "hi" };
        yield { type: "completed", text: "hi" };
      },
    });
    await runAdapterContractTest(adapter, "custom-model");
    expect(capturedModel).toBe("custom-model");
  });
});
