import { describe, it, expect } from "vitest";
import { AdapterRegistry } from "../core/adapter-registry.js";
import { FakeHarnessAdapter } from "../harness/fake-harness.js";
import {
  HarnessPlatform,
  UnknownHarnessError,
  HarnessNotAvailableError,
} from "./harness-platform.js";
import { createDefinition, createInstallation, createInstance } from "./entities.js";
import { capabilitySet } from "./capabilities.js";

function makeDefinition(id: string, adapterId = id) {
  return createDefinition({ id, name: id, adapterId });
}

function makeInstallation(id: string, definitionId: string) {
  return createInstallation({ id, definitionId, version: "1.0.0", path: "/tmp/" + id });
}

function makeInstance(id: string, definitionId: string, installationId: string, adapterId: string, state: "enabled" | "healthy" | "disabled" = "enabled") {
  return createInstance({ id, definitionId, installationId, adapterId, state });
}

describe("HarnessPlatform", () => {
  it("multiple definitions/installations/instances coexist and are listed", () => {
    const platform = new HarnessPlatform();
    const d1 = makeDefinition("d1", "a1");
    const d2 = makeDefinition("d2", "a2");
    const i1 = makeInstallation("i1", "d1");
    const i2 = makeInstallation("i2", "d2");
    const inst1 = makeInstance("inst1", "d1", "i1", "a1");
    const inst2 = makeInstance("inst2", "d2", "i2", "a2");

    platform.registerDefinition(d1);
    platform.registerDefinition(d2);
    platform.registerInstallation(i1);
    platform.registerInstallation(i2);
    platform.registerInstance(inst1);
    platform.registerInstance(inst2);

    expect(platform.listDefinitions()).toHaveLength(2);
    expect(platform.listInstallations()).toHaveLength(2);
    expect(platform.listInstances()).toHaveLength(2);
  });

  it("throws on duplicate definition registration", () => {
    const platform = new HarnessPlatform();
    platform.registerDefinition(makeDefinition("d1"));
    expect(() => platform.registerDefinition(makeDefinition("d1"))).toThrow(/already registered/);
  });

  it("resolveModel maps multi-segment model IDs correctly", () => {
    const platform = new HarnessPlatform();
    platform.registerDefinition(makeDefinition("command-code", "command-code"));
    platform.registerInstallation(makeInstallation("i1", "command-code"));
    platform.registerInstance(makeInstance("inst1", "command-code", "i1", "command-code"));

    const resolved = platform.resolveModel("command-code/deepseek/deepseek-v4-flash");
    expect(resolved.harness).toBe("command-code");
    expect(resolved.model).toBe("deepseek/deepseek-v4-flash");
    expect(resolved.adapterId).toBe("command-code");
    expect(resolved.instanceId).toBe("inst1");
  });

  it("resolveModel selects a healthy/enabled instance", () => {
    const platform = new HarnessPlatform();
    platform.registerDefinition(makeDefinition("h1", "a1"));
    platform.registerInstallation(makeInstallation("i1", "h1"));
    platform.registerInstance(makeInstance("inst1", "h1", "i1", "a1", "disabled"));
    platform.registerInstance(makeInstance("inst2", "h1", "i1", "a1", "healthy"));

    const resolved = platform.resolveModel("h1/model-x");
    expect(resolved.instanceId).toBe("inst2");
  });

  it("throws UnknownHarnessError for a harness with no instances", () => {
    const platform = new HarnessPlatform();
    expect(() => platform.resolveModel("unknown/model")).toThrow(UnknownHarnessError);
  });

  it("throws HarnessNotAvailableError when no instances are healthy/enabled", () => {
    const platform = new HarnessPlatform();
    platform.registerDefinition(makeDefinition("h1", "a1"));
    platform.registerInstallation(makeInstallation("i1", "h1"));
    platform.registerInstance(makeInstance("inst1", "h1", "i1", "a1", "disabled"));

    expect(() => platform.resolveModel("h1/model")).toThrow(HarnessNotAvailableError);
  });

  it("transitionInstallation advances state and reflects in listings", () => {
    const platform = new HarnessPlatform();
    platform.registerDefinition(makeDefinition("d1", "a1"));
    platform.registerInstallation(makeInstallation("i1", "d1"));

    platform.transitionInstallation("i1", "probe_succeeded");
    const updated = platform.transitionInstallation("i1", "install");
    expect(updated.state).toBe("installed");
    expect(platform.getInstallation("i1")?.state).toBe("installed");
    expect(platform.listInstallations()[0].state).toBe("installed");
  });

  it("getAdapter returns undefined when no AdapterRegistry is provided", () => {
    const platform = new HarnessPlatform();
    platform.registerDefinition(makeDefinition("h1", "a1"));
    platform.registerInstallation(makeInstallation("i1", "h1"));
    platform.registerInstance(makeInstance("inst1", "h1", "i1", "a1"));

    expect(platform.getAdapter("h1/model")).toBeUndefined();
  });
});

describe("HarnessPlatform integration with existing adapters", () => {
  it("existing adapters are usable through the platform layer", async () => {
    const registry = new AdapterRegistry();
    const fakeAdapter = new FakeHarnessAdapter();
    registry.register(fakeAdapter);

    const platform = new HarnessPlatform(registry);
    const def = createDefinition({ id: "fake-harness", name: "Fake Harness", adapterId: "fake-harness" });
    const inst = createInstallation({ id: "inst-1", definitionId: "fake-harness", version: "1.0.0", path: "/tmp/fake" });
    const instance = createInstance({
      id: "instance-1",
      definitionId: "fake-harness",
      installationId: "inst-1",
      adapterId: "fake-harness",
      models: ["fake-model"],
      state: "enabled",
    });

    platform.registerDefinition(def);
    platform.registerInstallation(inst);
    platform.registerInstance(instance);

    const resolved = platform.resolveModel("fake-harness/fake-model");
    expect(resolved).toEqual({
      harness: "fake-harness",
      model: "fake-model",
      adapterId: "fake-harness",
      instanceId: "instance-1",
    });

    const adapter = platform.getAdapter("fake-harness/fake-model");
    expect(adapter).toBeDefined();
    expect(adapter!.id).toBe("fake-harness");
    expect(await adapter!.listModels()).toContain("fake-model");
    expect(await adapter!.health()).toMatchObject({ ok: true });
  });
});
