import { describe, it, expect } from "vitest";
import { HarnessPlatform } from "./harness-platform.js";
import {
  createDefinition,
  createInstallation,
  createCredentialProfile,
  createInstance,
} from "./entities.js";
import { capabilitySet } from "./capabilities.js";
import { AdapterRegistry } from "../core/adapter-registry.js";
import { InMemorySecretStore } from "../credentials/secret-store.js";
import {
  HarnessLifecycleService,
  InstallationNotFoundError,
  CredentialProfileNotFoundError,
  HarnessLifecycleError,
} from "./harness-lifecycle.js";
import type { HarnessAdapter } from "../harness/types.js";

function makeTestAdapter(overrides?: Partial<HarnessAdapter>): HarnessAdapter {
  return {
    id: "test-adapter",
    async health() {
      return { ok: true, message: "healthy" };
    },
    async listModels() {
      return ["model-a", "model-b"];
    },
    async *run() {},
    async cancel() {},
    ...overrides,
  };
}

function setupLifecycle(opts?: { adapter?: HarnessAdapter }) {
  const platform = new HarnessPlatform();
  const secretStore = new InMemorySecretStore();
  const adapterRegistry = new AdapterRegistry();

  const adapter = opts?.adapter ?? makeTestAdapter();
  adapterRegistry.register(adapter);

  const def = createDefinition({
    id: "h1",
    name: "Harness One",
    adapterId: "test-adapter",
    capabilities: capabilitySet("streaming"),
  });
  const installation = createInstallation({
    id: "i1",
    definitionId: "h1",
    version: "1.0.0",
    path: "/tmp/i1",
  });
  const profile1 = createCredentialProfile({
    id: "p1",
    name: "Profile 1",
    definitionId: "h1",
    secretRef: "ref://p1",
  });
  const profile2 = createCredentialProfile({
    id: "p2",
    name: "Profile 2",
    definitionId: "h1",
    secretRef: "ref://p2",
  });
  const instance = createInstance({
    id: "inst-1",
    definitionId: "h1",
    installationId: "i1",
    adapterId: "test-adapter",
    credentialProfileId: "p1",
    models: ["model-a"],
    capabilities: capabilitySet("streaming"),
    state: "enabled",
  });

  platform.registerDefinition(def);
  platform.registerInstallation(installation);
  platform.registerCredentialProfile(profile1);
  platform.registerCredentialProfile(profile2);
  platform.registerInstance(instance);

  // Transition installation through the lifecycle to "enabled" state
  platform.transitionInstallation("i1", "probe_succeeded");
  platform.transitionInstallation("i1", "install");
  platform.transitionInstallation("i1", "configure");
  platform.transitionInstallation("i1", "authenticate");
  platform.transitionInstallation("i1", "enable");

  const service = new HarnessLifecycleService({ platform, secretStore, adapterRegistry });

  return { platform, secretStore, adapterRegistry, service, def, installation, profile1, profile2, instance };
}

describe("HarnessLifecycleService", () => {
  describe("listInstallations", () => {
    it("returns all registered installations", () => {
      const { service } = setupLifecycle();
      expect(service.listInstallations()).toHaveLength(1);
      expect(service.listInstallations()[0].id).toBe("i1");
    });
  });

  describe("listCredentialProfiles", () => {
    it("returns all profiles when no filter is given", () => {
      const { service } = setupLifecycle();
      expect(service.listCredentialProfiles()).toHaveLength(2);
    });

    it("filters profiles by definitionId", () => {
      const { service, platform } = setupLifecycle();
      const def2 = createDefinition({ id: "h2", name: "H2", adapterId: "test-adapter" });
      platform.registerDefinition(def2);
      const pOther = createCredentialProfile({ id: "p-other", name: "Other", definitionId: "h2", secretRef: "ref://other" });
      platform.registerCredentialProfile(pOther);

      const filtered = service.listCredentialProfiles("h1");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((p) => p.definitionId === "h1")).toBe(true);
    });
  });

  describe("enableInstallation", () => {
    it("is idempotent for already enabled installations", () => {
      const { service } = setupLifecycle();
      const result = service.enableInstallation("i1");
      expect(result.state).toBe("enabled");
    });

    it("enables a disabled installation", () => {
      const { service, platform } = setupLifecycle();
      platform.transitionInstallation("i1", "disable");
      const result = service.enableInstallation("i1");
      expect(result.state).toBe("enabled");
    });

    it("throws InstallationNotFoundError for unknown id", () => {
      const { service } = setupLifecycle();
      expect(() => service.enableInstallation("nonexistent")).toThrow(InstallationNotFoundError);
    });

    it("throws HarnessLifecycleError for a discovered installation", () => {
      const { service, platform } = setupLifecycle();
      const inst2 = createInstallation({ id: "i2", definitionId: "h1", version: "1.0.0", path: "/tmp/i2" });
      platform.registerInstallation(inst2);
      expect(() => service.enableInstallation("i2")).toThrow(HarnessLifecycleError);
    });
  });

  describe("disableInstallation", () => {
    it("is idempotent for already disabled installations", () => {
      const { service, platform } = setupLifecycle();
      platform.transitionInstallation("i1", "disable");
      const result = service.disableInstallation("i1");
      expect(result.state).toBe("disabled");
    });

    it("disables an enabled installation", () => {
      const { service } = setupLifecycle();
      const result = service.disableInstallation("i1");
      expect(result.state).toBe("disabled");
    });

    it("throws InstallationNotFoundError for unknown id", () => {
      const { service } = setupLifecycle();
      expect(() => service.disableInstallation("nonexistent")).toThrow(InstallationNotFoundError);
    });

    it("throws HarnessLifecycleError for a discovered installation", () => {
      const { service, platform } = setupLifecycle();
      const inst2 = createInstallation({ id: "i2", definitionId: "h1", version: "1.0.0", path: "/tmp/i2" });
      platform.registerInstallation(inst2);
      expect(() => service.disableInstallation("i2")).toThrow(HarnessLifecycleError);
    });
  });

  describe("removeInstallation", () => {
    it("removes a registered installation", () => {
      const { service } = setupLifecycle();
      const result = service.removeInstallation("i1");
      expect(result.state).toBe("removed");
    });

    it("throws InstallationNotFoundError for unknown id", () => {
      const { service } = setupLifecycle();
      expect(() => service.removeInstallation("nonexistent")).toThrow(InstallationNotFoundError);
    });
  });

  describe("selectInstallation", () => {
    it("sets the active instance for a definition/installation pair", () => {
      const { service, platform } = setupLifecycle();
      service.selectInstallation("h1", "i1");
      const active = platform.getActiveInstance("h1");
      expect(active?.id).toBe("inst-1");
    });

    it("throws for an unknown definition", () => {
      const { service } = setupLifecycle();
      expect(() => service.selectInstallation("nonexistent", "i1")).toThrow(InstallationNotFoundError);
    });

    it("throws for an unknown installation", () => {
      const { service } = setupLifecycle();
      expect(() => service.selectInstallation("h1", "nonexistent")).toThrow(InstallationNotFoundError);
    });

    it("throws when installation belongs to a different definition", () => {
      const { service, platform } = setupLifecycle();
      const def2 = createDefinition({ id: "h2", name: "H2", adapterId: "test-adapter" });
      const inst2 = createInstallation({ id: "i2", definitionId: "h2", version: "1.0.0", path: "/tmp/i2" });
      platform.registerDefinition(def2);
      platform.registerInstallation(inst2);
      expect(() => service.selectInstallation("h1", "i2")).toThrow(HarnessLifecycleError);
    });

    it("throws when no enabled/healthy instance exists for the pair", () => {
      const { service, platform } = setupLifecycle();
      const inst2 = createInstallation({ id: "i2", definitionId: "h1", version: "2.0.0", path: "/tmp/i2" });
      platform.registerInstallation(inst2);
      const inst2Instance = createInstance({
        id: "inst-2",
        definitionId: "h1",
        installationId: "i2",
        adapterId: "test-adapter",
        state: "disabled",
      });
      platform.registerInstance(inst2Instance);
      expect(() => service.selectInstallation("h1", "i2")).toThrow(HarnessLifecycleError);
    });
  });

  describe("selectCredentialProfile", () => {
    it("sets the credential profile override for an instance", () => {
      const { service, platform } = setupLifecycle();
      service.selectCredentialProfile("inst-1", "p2");
      const runtime = platform.resolveRuntime("h1/model-a");
      expect(runtime.credentialProfileId).toBe("p2");
    });

    it("throws CredentialProfileNotFoundError for unknown profile", () => {
      const { service } = setupLifecycle();
      expect(() => service.selectCredentialProfile("inst-1", "nonexistent")).toThrow(CredentialProfileNotFoundError);
    });

    it("propagates platform validation errors for mismatched definitions", () => {
      const { service, platform } = setupLifecycle();
      const def2 = createDefinition({ id: "h2", name: "H2", adapterId: "test-adapter" });
      platform.registerDefinition(def2);
      const pH2 = createCredentialProfile({ id: "p-h2", name: "P H2", definitionId: "h2", secretRef: "ref://p-h2" });
      platform.registerCredentialProfile(pH2);
      expect(() => service.selectCredentialProfile("inst-1", "p-h2")).toThrow(/belongs to definition/);
    });
  });

  describe("inspectCapabilities", () => {
    it("returns the instance capabilities", () => {
      const { service } = setupLifecycle();
      const caps = service.inspectCapabilities("inst-1");
      expect(caps.has("streaming")).toBe(true);
    });

    it("throws for an unknown instance", () => {
      const { service } = setupLifecycle();
      expect(() => service.inspectCapabilities("nonexistent")).toThrow(/not registered/);
    });
  });

  describe("listModels", () => {
    it("returns models from the adapter", async () => {
      const { service } = setupLifecycle();
      const models = await service.listModels("h1/model-a");
      expect(models).toEqual(["model-a", "model-b"]);
    });

    it("returns empty array when no adapter is available", async () => {
      const platform = new HarnessPlatform();
      const secretStore = new InMemorySecretStore();
      const service = new HarnessLifecycleService({ platform, secretStore });

      const def = createDefinition({ id: "h1", name: "H1", adapterId: "a1" });
      const inst = createInstallation({ id: "i1", definitionId: "h1", version: "1.0.0", path: "/tmp" });
      const instance = createInstance({ id: "inst-1", definitionId: "h1", installationId: "i1", adapterId: "a1", state: "enabled" });
      platform.registerDefinition(def);
      platform.registerInstallation(inst);
      platform.registerInstance(instance);

      const models = await service.listModels("h1/model");
      expect(models).toEqual([]);
    });
  });

  describe("healthCheck", () => {
    it("returns ok true when adapter health passes", async () => {
      const { service } = setupLifecycle();
      const health = await service.healthCheck("i1");
      expect(health.ok).toBe(true);
      expect(health.installationId).toBe("i1");
    });

    it("returns ok false when no adapter is available", async () => {
      const platform = new HarnessPlatform();
      const secretStore = new InMemorySecretStore();
      const service = new HarnessLifecycleService({ platform, secretStore });

      const def = createDefinition({ id: "h1", name: "H1", adapterId: "a1" });
      const inst = createInstallation({ id: "i1", definitionId: "h1", version: "1.0.0", path: "/tmp" });
      platform.registerDefinition(def);
      platform.registerInstallation(inst);

      const health = await service.healthCheck("i1");
      expect(health.ok).toBe(false);
      expect(health.message).toBe("No adapter available for definition.");
    });

    it("throws InstallationNotFoundError for unknown installation", async () => {
      const { service } = setupLifecycle();
      await expect(service.healthCheck("nonexistent")).rejects.toThrow(InstallationNotFoundError);
    });
  });

  describe("authenticationStatus", () => {
    it("returns authenticated status for a profile with a stored secret", () => {
      const { service, secretStore } = setupLifecycle();
      secretStore.set("ref://p1", "my-secret");
      const status = service.authenticationStatus("p1");
      expect(status.authenticated).toBe(true);
      expect(status.profileId).toBe("p1");
    });

    it("returns unauthenticated status when secret is missing", () => {
      const { service } = setupLifecycle();
      const status = service.authenticationStatus("p1");
      expect(status.authenticated).toBe(false);
      expect(status.reason).toBe("Credential material not found for profile.");
    });

    it("throws CredentialProfileNotFoundError for unknown profile", () => {
      const { service } = setupLifecycle();
      expect(() => service.authenticationStatus("nonexistent")).toThrow(CredentialProfileNotFoundError);
    });

    it("raw secret never appears in JSON.stringify of the status", () => {
      const { service, secretStore } = setupLifecycle();
      secretStore.set("ref://p1", "sk-live-ULTRASECRET");
      const status = service.authenticationStatus("p1");
      const json = JSON.stringify(status);
      expect(json).not.toContain("sk-live-ULTRASECRET");
      expect(json).not.toContain("ref://p1");
    });
  });

  describe("multiple profiles per definition", () => {
    it("lists profiles independently", () => {
      const { service } = setupLifecycle();
      const profiles = service.listCredentialProfiles("h1");
      expect(profiles.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    });

    it("each profile has independent authentication status", () => {
      const { service, secretStore } = setupLifecycle();
      secretStore.set("ref://p1", "secret-1");
      const s1 = service.authenticationStatus("p1");
      const s2 = service.authenticationStatus("p2");
      expect(s1.authenticated).toBe(true);
      expect(s2.authenticated).toBe(false);
    });
  });
});
