import { describe, it, expect, beforeEach } from "vitest";
import { RunStore } from "./store.js";

describe("RunStore", () => {
  let store: RunStore;

  beforeEach(() => {
    store = new RunStore(":memory:");
  });

  it("persists a run lifecycle transition and event round-trip", () => {
    store.createRun({
      id: "run-1",
      requestedModel: "fake-harness/fake-model",
      resolvedModel: "fake-model",
      harness: "fake-harness",
    });

    const created = store.getRun("run-1");
    expect(created?.status).toBe("queued");
    expect(created?.requested_model).toBe("fake-harness/fake-model");
    expect(created?.resolved_model).toBe("fake-model");
    expect(created?.harness).toBe("fake-harness");

    store.markStarted("run-1");
    expect(store.getRun("run-1")?.status).toBe("running");
    expect(store.getRun("run-1")?.started_at).toBeTruthy();

    store.appendEvent("run-1", "started", { sessionId: "s1" });
    store.appendEvent("run-1", "completed", { text: "hello" });

    store.updateRunMeta("run-1", { sessionId: "s1", usageJson: JSON.stringify({ inputTokens: 1 }) });
    store.markFinished("run-1", "completed");

    const finished = store.getRun("run-1")!;
    expect(finished.status).toBe("completed");
    expect(finished.session_id).toBe("s1");
    expect(JSON.parse(finished.usage_json!)).toEqual({ inputTokens: 1 });
    expect(finished.finished_at).toBeTruthy();
    expect(finished.duration_ms).toBeGreaterThanOrEqual(0);

    const events = store.listEvents("run-1");
    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(1);
    expect(events[0].type).toBe("started");
    expect(JSON.parse(events[0].payload_json)).toEqual({ sessionId: "s1" });
    expect(events[1].seq).toBe(2);
  });

  it("stores and reads model aliases", () => {
    store.setAlias("cc", "command-code/deepseek/deepseek-v4-flash");
    expect(store.getAlias("cc")).toBe("command-code/deepseek/deepseek-v4-flash");
    expect(store.getAlias("missing")).toBeUndefined();
  });

  it("marks rejected status with a message", () => {
    store.createRun({ id: "run-2", requestedModel: "unknown/x" });
    store.markStarted("run-2");
    store.markFinished("run-2", "rejected", "Queue is full");
    expect(store.getRun("run-2")?.status).toBe("rejected");
    expect(store.getRun("run-2")?.error_message).toBe("Queue is full");
  });
});
