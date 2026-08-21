import { describe, it, expect } from "vitest";
import {
  createDefinition,
  createInstallation,
  createCredentialProfile,
  createInstance,
} from "./entities.js";

describe("createDefinition", () => {
  it("builds the expected object and defaults capabilities to an empty set", () => {
    const def = createDefinition({ id: "d1", name: "Test", adapterId: "a1" });
    expect(def.id).toBe("d1");
    expect(def.name).toBe("Test");
    expect(def.adapterId).toBe("a1");
    expect(def.capabilities.size).toBe(0);
  });

  it("rejects empty required strings", () => {
    expect(() => createDefinition({ id: "", name: "n", adapterId: "a" })).toThrow();
    expect(() => createDefinition({ id: "d", name: "", adapterId: "a" })).toThrow();
    expect(() => createDefinition({ id: "d", name: "n", adapterId: "" })).toThrow();
  });
});

describe("createInstallation", () => {
  it("defaults state to discovered", () => {
    const inst = createInstallation({ id: "i1", definitionId: "d1", version: "1.0.0", path: "/tmp" });
    expect(inst.state).toBe("discovered");
  });

  it("rejects empty required strings", () => {
    expect(() => createInstallation({ id: "", definitionId: "d", version: "1", path: "/" })).toThrow();
    expect(() => createInstallation({ id: "i", definitionId: "", version: "1", path: "/" })).toThrow();
    expect(() => createInstallation({ id: "i", definitionId: "d", version: "", path: "/" })).toThrow();
    expect(() => createInstallation({ id: "i", definitionId: "d", version: "1", path: "" })).toThrow();
  });
});

describe("createCredentialProfile", () => {
  it("stores only an opaque secretRef", () => {
    const profile = createCredentialProfile({
      id: "cp1",
      name: "My Key",
      definitionId: "d1",
      secretRef: "ref://vault/credentials/cp1",
    });
    expect(profile.secretRef).toBe("ref://vault/credentials/cp1");
    expect(Object.prototype.hasOwnProperty.call(profile, "secret")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(profile, "token")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(profile, "apiKey")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(profile, "password")).toBe(false);
    expect(JSON.stringify(profile)).not.toContain("sk-live-1234");
  });

  it("rejects empty required strings", () => {
    expect(() => createCredentialProfile({ id: "", name: "n", definitionId: "d", secretRef: "s" })).toThrow();
    expect(() => createCredentialProfile({ id: "c", name: "", definitionId: "d", secretRef: "s" })).toThrow();
    expect(() => createCredentialProfile({ id: "c", name: "n", definitionId: "", secretRef: "s" })).toThrow();
    expect(() => createCredentialProfile({ id: "c", name: "n", definitionId: "d", secretRef: "" })).toThrow();
  });
});

describe("createInstance", () => {
  it("defaults models, capabilities, and state correctly", () => {
    const inst = createInstance({
      id: "inst1",
      definitionId: "d1",
      installationId: "i1",
      adapterId: "a1",
    });
    expect(inst.models).toEqual([]);
    expect(inst.capabilities.size).toBe(0);
    expect(inst.state).toBe("enabled");
  });

  it("rejects empty required strings", () => {
    const base = { definitionId: "d", installationId: "i", adapterId: "a" };
    expect(() => createInstance({ ...base, id: "" })).toThrow();
    expect(() => createInstance({ ...base, id: "x", definitionId: "" })).toThrow();
    expect(() => createInstance({ ...base, id: "x", installationId: "" })).toThrow();
    expect(() => createInstance({ ...base, id: "x", adapterId: "" })).toThrow();
  });
});
