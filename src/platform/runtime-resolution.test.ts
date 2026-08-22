import { describe, it, expect } from "vitest";
import {
  HarnessPlatform,
  UnknownHarnessError,
  HarnessNotAvailableError,
} from "./harness-platform.js";
import {
  createDefinition,
  createInstallation,
  createCredentialProfile,
  createInstance,
} from "./entities.js";
import { capabilitySet } from "./capabilities.js";

function setupPlatform() {
  const platform = new HarnessPlatform();
  const def = createDefinition({
    id: "h1",
    name: "Harness One",
    adapterId: "adapter-1",
    capabilities: capabilitySet("streaming", "sessions"),
  });
  const inst1 = createInstallation({ id: "i1", definitionId: "h1", version: "1.0.0", path: "/tmp/i1" });
  const inst2 = createInstallation({ id: "i2", definitionId: "h1", version: "2.0.0", path: "/tmp/i2" });
  const profile1 = createCredentialProfile({ id: "p1", name: "Profile 1", definitionId: "h1", secretRef: "ref://p1" });
  const profile2 = createCredentialProfile({ id: "p2", name: "Profile 2", definitionId: "h1", secretRef: "ref://p2" });
  const instance1 = createInstance({
    id: "inst-1",
    definitionId: "h1",
    installationId: "i1",
    adapterId: "adapter-1",
    credentialProfileId: "p1",
    models: ["model-a", "model-b"],
    capabilities: capabilitySet("streaming", "sessions"),
    state: "enabled",
  });
  const instance2 = createInstance({
    id: "inst-2",
    definitionId: "h1",
    installationId: "i2",
    adapterId: "adapter-1",
    credentialProfileId: "p2",
    models: ["model-c"],
    capabilities: capabilitySet("streaming"),
    state: "enabled",
  });

  platform.registerDefinition(def);
  platform.registerInstallation(inst1);
  platform.registerInstallation(inst2);
  platform.registerCredentialProfile(profile1);
  platform.registerCredentialProfile(profile2);
  platform.registerInstance(instance1);
  platform.registerInstance(instance2);

  return { platform, def, inst1, inst2, profile1, profile2, instance1, instance2 };
}

describe("resolveRuntime", () => {
  it("returns full ResolvedRuntime with installationId, capabilities, and models", () => {
    const { platform } = setupPlatform();
    const runtime = platform.resolveRuntime("h1/model-a");
    expect(runtime.harness).toBe("h1");
    expect(runtime.model).toBe("model-a");
    expect(runtime.adapterId).toBe("adapter-1");
    expect(runtime.installationId).toBe("i1");
    expect(runtime.capabilities).toEqual(capabilitySet("streaming", "sessions"));
    expect(runtime.models).toEqual(["model-a", "model-b"]);
  });

  it("throws UnknownHarnessError when no instances exist for the harness", () => {
    const platform = new HarnessPlatform();
    expect(() => platform.resolveRuntime("unknown/model")).toThrow(UnknownHarnessError);
  });

  it("throws HarnessNotAvailableError when all instances are disabled", () => {
    const platform = new HarnessPlatform();
    const def = createDefinition({ id: "h1", name: "H1", adapterId: "a1" });
    const inst = createInstallation({ id: "i1", definitionId: "h1", version: "1.0.0", path: "/tmp" });
    const instance = createInstance({
      id: "inst-1",
      definitionId: "h1",
      installationId: "i1",
      adapterId: "a1",
      state: "disabled",
    });
    platform.registerDefinition(def);
    platform.registerInstallation(inst);
    platform.registerInstance(instance);

    expect(() => platform.resolveRuntime("h1/model")).toThrow(HarnessNotAvailableError);
  });

  it("uses the instance's own credentialProfileId when no override is set", () => {
    const { platform } = setupPlatform();
    const runtime = platform.resolveRuntime("h1/model-a");
    expect(runtime.credentialProfileId).toBe("p1");
  });

  it("resolves multi-segment model IDs", () => {
    const { platform } = setupPlatform();
    const runtime = platform.resolveRuntime("h1/provider/model-x");
    expect(runtime.harness).toBe("h1");
    expect(runtime.model).toBe("provider/model-x");
  });
});

describe("setActiveInstance", () => {
  it("selects an instance as active for its definition", () => {
    const { platform, instance2 } = setupPlatform();
    platform.setActiveInstance("inst-2");
    const runtime = platform.resolveRuntime("h1/model-a");
    expect(runtime.instanceId).toBe("inst-2");
    expect(runtime.installationId).toBe("i2");
  });

  it("throws for an unknown instance", () => {
    const { platform } = setupPlatform();
    expect(() => platform.setActiveInstance("nonexistent")).toThrow(/not registered/);
  });
});

describe("clearActiveInstance", () => {
  it("clears the active instance so fallback logic resumes", () => {
    const { platform } = setupPlatform();
    platform.setActiveInstance("inst-2");
    platform.clearActiveInstance("h1");
    const runtime = platform.resolveRuntime("h1/model-a");
    expect(runtime.instanceId).toBe("inst-1");
  });
});

describe("setCredentialProfile", () => {
  it("overrides the credential profile for an instance", () => {
    const { platform } = setupPlatform();
    platform.setCredentialProfile("inst-1", "p2");
    const runtime = platform.resolveRuntime("h1/model-a");
    expect(runtime.credentialProfileId).toBe("p2");
  });

  it("throws for an unknown instance", () => {
    const { platform } = setupPlatform();
    expect(() => platform.setCredentialProfile("nonexistent", "p1")).toThrow(/not registered/);
  });

  it("throws for an unknown profile", () => {
    const { platform } = setupPlatform();
    expect(() => platform.setCredentialProfile("inst-1", "nonexistent")).toThrow(/not registered/);
  });

  it("throws when profile belongs to a different definition", () => {
    const platform = new HarnessPlatform();
    const def1 = createDefinition({ id: "h1", name: "H1", adapterId: "a1" });
    const def2 = createDefinition({ id: "h2", name: "H2", adapterId: "a2" });
    const inst1 = createInstallation({ id: "i1", definitionId: "h1", version: "1.0.0", path: "/tmp/i1" });
    const inst2 = createInstallation({ id: "i2", definitionId: "h2", version: "1.0.0", path: "/tmp/i2" });
    const profileH2 = createCredentialProfile({ id: "p-h2", name: "P H2", definitionId: "h2", secretRef: "ref://p-h2" });
    const instance1 = createInstance({ id: "inst-1", definitionId: "h1", installationId: "i1", adapterId: "a1", state: "enabled" });

    platform.registerDefinition(def1);
    platform.registerDefinition(def2);
    platform.registerInstallation(inst1);
    platform.registerInstallation(inst2);
    platform.registerCredentialProfile(profileH2);
    platform.registerInstance(instance1);

    expect(() => platform.setCredentialProfile("inst-1", "p-h2")).toThrow(/belongs to definition/);
  });
});

describe("getActiveInstance", () => {
  it("returns undefined when no active instance is set", () => {
    const { platform } = setupPlatform();
    expect(platform.getActiveInstance("h1")).toBeUndefined();
  });

  it("returns the active instance when it is enabled", () => {
    const { platform } = setupPlatform();
    platform.setActiveInstance("inst-1");
    const active = platform.getActiveInstance("h1");
    expect(active?.id).toBe("inst-1");
  });

  it("returns undefined when the active instance is disabled", () => {
    const platform = new HarnessPlatform();
    const def = createDefinition({ id: "h1", name: "H1", adapterId: "a1" });
    const inst = createInstallation({ id: "i1", definitionId: "h1", version: "1.0.0", path: "/tmp" });
    const instance = createInstance({
      id: "inst-1",
      definitionId: "h1",
      installationId: "i1",
      adapterId: "a1",
      state: "disabled",
    });
    platform.registerDefinition(def);
    platform.registerInstallation(inst);
    platform.registerInstance(instance);
    platform.setActiveInstance("inst-1");

    expect(platform.getActiveInstance("h1")).toBeUndefined();
  });

  it("returns the active instance when it is healthy", () => {
    const platform = new HarnessPlatform();
    const def = createDefinition({ id: "h1", name: "H1", adapterId: "a1" });
    const inst = createInstallation({ id: "i1", definitionId: "h1", version: "1.0.0", path: "/tmp" });
    const instance = createInstance({
      id: "inst-1",
      definitionId: "h1",
      installationId: "i1",
      adapterId: "a1",
      state: "healthy",
    });
    platform.registerDefinition(def);
    platform.registerInstallation(inst);
    platform.registerInstance(instance);
    platform.setActiveInstance("inst-1");

    expect(platform.getActiveInstance("h1")?.id).toBe("inst-1");
  });
});

describe("enable/disable enforcement in resolveRuntime", () => {
  it("skips disabled instances and picks the next enabled one", () => {
    const platform = new HarnessPlatform();
    const def = createDefinition({ id: "h1", name: "H1", adapterId: "a1" });
    const inst = createInstallation({ id: "i1", definitionId: "h1", version: "1.0.0", path: "/tmp" });
    const disabled = createInstance({
      id: "inst-disabled",
      definitionId: "h1",
      installationId: "i1",
      adapterId: "a1",
      state: "disabled",
    });
    const enabled = createInstance({
      id: "inst-enabled",
      definitionId: "h1",
      installationId: "i1",
      adapterId: "a1",
      state: "enabled",
    });
    platform.registerDefinition(def);
    platform.registerInstallation(inst);
    platform.registerInstance(disabled);
    platform.registerInstance(enabled);

    const runtime = platform.resolveRuntime("h1/model");
    expect(runtime.instanceId).toBe("inst-enabled");
  });

  it("throws HarnessNotAvailableError when only disabled instances exist", () => {
    const platform = new HarnessPlatform();
    const def = createDefinition({ id: "h1", name: "H1", adapterId: "a1" });
    const inst = createInstallation({ id: "i1", definitionId: "h1", version: "1.0.0", path: "/tmp" });
    const disabled = createInstance({
      id: "inst-1",
      definitionId: "h1",
      installationId: "i1",
      adapterId: "a1",
      state: "disabled",
    });
    platform.registerDefinition(def);
    platform.registerInstallation(inst);
    platform.registerInstance(disabled);

    expect(() => platform.resolveRuntime("h1/model")).toThrow(HarnessNotAvailableError);
  });
});
