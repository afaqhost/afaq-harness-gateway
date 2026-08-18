import { describe, it, expect } from "vitest";
import { AdapterRegistry } from "./adapter-registry.js";
import { RunService, RunRejectedError } from "./run-service.js";
import { RunStore } from "./store.js";
import { PricingRegistry } from "./pricing.js";
import { FakeHarnessAdapter } from "../harness/fake-harness.js";

describe("RunService", () => {
  it("runs a fake harness and persists queued -> running -> completed with events + usage", async () => {
    const registry = new AdapterRegistry();
    registry.register(new FakeHarnessAdapter());
    const store = new RunStore(":memory:");
    const service = new RunService({ adapterRegistry: registry, store });

    const result = await service.run({
      model: "fake-harness/fake-model",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.events.some((e) => e.type === "completed")).toBe(true);
    expect(result.events.some((e) => e.type === "usage")).toBe(true);

    const run = store.getRun(result.runId)!;
    expect(run.status).toBe("completed");
    expect(run.resolved_model).toBe("fake-model");
    expect(run.harness).toBe("fake-harness");
    expect(run.session_id).toBe("fake-session-001");
    expect(JSON.parse(run.usage_json!)).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(run.duration_ms).toBeGreaterThanOrEqual(0);

    const events = store.listEvents(result.runId);
    const types = events.map((e) => e.type);
    expect(types).toContain("queued_to_running");
    expect(types).toContain("started");
    expect(types).toContain("text_delta");
    expect(types).toContain("usage");
    expect(types).toContain("completed");
  });

  it("rejects an invalid model id", async () => {
    const registry = new AdapterRegistry();
    registry.register(new FakeHarnessAdapter());
    const store = new RunStore(":memory:");
    const service = new RunService({ adapterRegistry: registry, store });

    await expect(service.run({ model: "nomodel", messages: [] })).rejects.toBeInstanceOf(RunRejectedError);
    await expect(service.run({ model: "nomodel", messages: [] })).rejects.toMatchObject({ code: "invalid_model" });

    const runs = store.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[runs.length - 1].status).toBe("rejected");
  });

  it("rejects an unknown harness", async () => {
    const registry = new AdapterRegistry();
    registry.register(new FakeHarnessAdapter());
    const store = new RunStore(":memory:");
    const service = new RunService({ adapterRegistry: registry, store });

    await expect(service.run({ model: "mystery/model", messages: [] })).rejects.toBeInstanceOf(RunRejectedError);
    await expect(service.run({ model: "mystery/model", messages: [] })).rejects.toMatchObject({ code: "unknown_harness" });
  });

  it("resolves a stored alias before execution", async () => {
    const registry = new AdapterRegistry();
    registry.register(new FakeHarnessAdapter());
    const store = new RunStore(":memory:");
    store.setAlias("fake", "fake-harness/fake-model");
    const service = new RunService({ adapterRegistry: registry, store });

    const result = await service.run({ model: "fake", messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("completed");

    if (result.status !== "completed") throw new Error("unreachable");
    const run = store.getRun(result.runId)!;
    expect(run.requested_model).toBe("fake");
    expect(run.resolved_model).toBe("fake-model");
  });

  it("rejects a model not in the allowed list before executing", async () => {
    const registry = new AdapterRegistry();
    registry.register(new FakeHarnessAdapter());
    const store = new RunStore(":memory:");
    const service = new RunService({ adapterRegistry: registry, store });

    await expect(
      service.run({
        model: "fake-harness/fake-model",
        messages: [{ role: "user", content: "hi" }],
        allowedModels: ["fake-harness/other-model"],
      }),
    ).rejects.toBeInstanceOf(RunRejectedError);
    await expect(
      service.run({
        model: "fake-harness/fake-model",
        messages: [],
        allowedModels: ["fake-harness/other-model"],
      }),
    ).rejects.toMatchObject({ code: "model_not_allowed" });

    const runs = store.listRuns();
    const rejected = runs.find((r) => r.status === "rejected");
    expect(rejected).toBeDefined();
    // No adapter run should have produced usage or session
    expect(rejected!.usage_json).toBeNull();
    expect(rejected!.session_id).toBeNull();
  });

  it("passes apiKeyId to the persisted run", async () => {
    const registry = new AdapterRegistry();
    registry.register(new FakeHarnessAdapter());
    const store = new RunStore(":memory:");
    const service = new RunService({ adapterRegistry: registry, store });

    const result = await service.run({
      model: "fake-harness/fake-model",
      messages: [{ role: "user", content: "hi" }],
      apiKeyId: "key-abc",
    });

    expect(result.status).toBe("completed");
    const run = store.getRun(result.runId)!;
    expect(run.api_key_id).toBe("key-abc");
  });

  it("persists estimated_cost_usd when usage is present", async () => {
    const registry = new AdapterRegistry();
    registry.register(new FakeHarnessAdapter());
    const store = new RunStore(":memory:");
    const service = new RunService({ adapterRegistry: registry, store });

    const result = await service.run({
      model: "fake-harness/fake-model",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.status).toBe("completed");
    const run = store.getRun(result.runId)!;
    expect(run.estimated_cost_usd).not.toBeNull();
    expect(run.estimated_cost_usd).toBeGreaterThan(0);
  });

  it("getEstimatedCostSince delegates to the store", async () => {
    const registry = new AdapterRegistry();
    registry.register(new FakeHarnessAdapter());
    const store = new RunStore(":memory:");
    const service = new RunService({ adapterRegistry: registry, store });

    await service.run({
      model: "fake-harness/fake-model",
      messages: [{ role: "user", content: "hi" }],
      apiKeyId: "k1",
    });

    const cost = service.getEstimatedCostSince("k1", "2000-01-01T00:00:00.000Z");
    expect(cost).toBeGreaterThan(0);
  });
});
