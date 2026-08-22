import { describe, it, expect } from "vitest";
import {
  TenantHarnessConfigError,
  TenantConfigStore,
  TenantConfigRegistry,
} from "./tenant-config.js";

describe("TenantConfigStore", () => {
  it("throws for empty tenantId", () => {
    expect(() => new TenantConfigStore("")).toThrow(TenantHarnessConfigError);
  });

  it("setHarnessConfig returns a TenantHarnessConfig", () => {
    const store = new TenantConfigStore("t1");
    const result = store.setHarnessConfig("def1", { key: "value" });
    expect(result.definitionId).toBe("def1");
    expect(result.config).toEqual({ key: "value" });
    expect(result.updatedAt).toBeTruthy();
  });

  it("throws for empty definitionId", () => {
    const store = new TenantConfigStore("t1");
    expect(() => store.setHarnessConfig("", {})).toThrow(TenantHarnessConfigError);
  });

  it("getHarnessConfig returns a shallow copy", () => {
    const store = new TenantConfigStore("t1");
    store.setHarnessConfig("def1", { key: "value" });
    const config = store.getHarnessConfig("def1");
    expect(config).toEqual({ key: "value" });

    config!.key = "mutated";
    expect(store.getHarnessConfig("def1")).toEqual({ key: "value" });
  });

  it("getHarnessConfig returns undefined for unknown definitionId", () => {
    const store = new TenantConfigStore("t1");
    expect(store.getHarnessConfig("unknown")).toBeUndefined();
  });

  it("listHarnessConfigs returns all configs", () => {
    const store = new TenantConfigStore("t1");
    store.setHarnessConfig("def1", { a: 1 });
    store.setHarnessConfig("def2", { b: 2 });
    const list = store.listHarnessConfigs();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.definitionId).sort()).toEqual(["def1", "def2"]);
  });

  it("removeHarnessConfig removes and returns true", () => {
    const store = new TenantConfigStore("t1");
    store.setHarnessConfig("def1", { a: 1 });
    expect(store.removeHarnessConfig("def1")).toBe(true);
    expect(store.getHarnessConfig("def1")).toBeUndefined();
  });

  it("removeHarnessConfig returns false for unknown", () => {
    const store = new TenantConfigStore("t1");
    expect(store.removeHarnessConfig("unknown")).toBe(false);
  });
});

describe("TenantConfigRegistry", () => {
  it("throws for unknown tenant", () => {
    const registry = new TenantConfigRegistry();
    expect(() => registry.setHarnessConfig("unknown", "def1", {})).toThrow(
      TenantHarnessConfigError,
    );
    expect(() => registry.getHarnessConfig("unknown", "def1")).toThrow(
      TenantHarnessConfigError,
    );
    expect(() => registry.listHarnessConfigs("unknown")).toThrow(TenantHarnessConfigError);
    expect(() => registry.removeHarnessConfig("unknown", "def1")).toThrow(
      TenantHarnessConfigError,
    );
  });

  it("registerTenant throws for duplicate", () => {
    const registry = new TenantConfigRegistry();
    registry.registerTenant("t1");
    expect(() => registry.registerTenant("t1")).toThrow(TenantHarnessConfigError);
  });

  it("enforces cross-tenant isolation", () => {
    const registry = new TenantConfigRegistry();
    registry.registerTenant("t1");
    registry.registerTenant("t2");

    registry.setHarnessConfig("t1", "shared-def", { owner: "t1" });
    registry.setHarnessConfig("t2", "shared-def", { owner: "t2" });

    expect(registry.getHarnessConfig("t1", "shared-def")).toEqual({ owner: "t1" });
    expect(registry.getHarnessConfig("t2", "shared-def")).toEqual({ owner: "t2" });
  });

  it("full CRUD through registry", () => {
    const registry = new TenantConfigRegistry();
    registry.registerTenant("t1");

    registry.setHarnessConfig("t1", "def1", { a: 1 });
    expect(registry.getHarnessConfig("t1", "def1")).toEqual({ a: 1 });

    const list = registry.listHarnessConfigs("t1");
    expect(list).toHaveLength(1);

    expect(registry.removeHarnessConfig("t1", "def1")).toBe(true);
    expect(registry.listHarnessConfigs("t1")).toHaveLength(0);
  });
});
