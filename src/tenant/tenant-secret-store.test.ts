import { describe, it, expect } from "vitest";
import { InMemorySecretStore } from "../credentials/secret-store.js";
import {
  TenantSecretStore,
  TenantSecretBoundaryError,
  tenantSecretRef,
} from "./tenant-secret-store.js";

describe("tenantSecretRef", () => {
  it("returns a namespaced ref", () => {
    expect(tenantSecretRef("t1", "api-key")).toBe("tenant:t1:api-key");
  });

  it("rejects empty tenantId", () => {
    expect(() => tenantSecretRef("", "api-key")).toThrow(/non-empty/);
  });

  it("rejects empty ref", () => {
    expect(() => tenantSecretRef("t1", "")).toThrow(/non-empty/);
  });
});

describe("TenantSecretStore", () => {
  it("delegates set/get/has/delete to backing store with namespaced ref", () => {
    const backing = new InMemorySecretStore();
    const store = new TenantSecretStore("t1", backing);
    const ref = tenantSecretRef("t1", "api-key");

    store.set(ref, "secret-value");
    expect(store.has(ref)).toBe(true);
    expect(store.get(ref)).toBe("secret-value");

    expect(backing.has(ref)).toBe(true);
    expect(backing.get(ref)).toBe("secret-value");

    expect(store.delete(ref)).toBe(true);
    expect(store.has(ref)).toBe(false);
  });

  it("throws TenantSecretBoundaryError for ref outside tenant namespace", () => {
    const backing = new InMemorySecretStore();
    const store = new TenantSecretStore("t1", backing);

    expect(() => store.has("tenant:t2:api-key")).toThrow(TenantSecretBoundaryError);
    expect(() => store.get("tenant:t2:api-key")).toThrow(TenantSecretBoundaryError);
    expect(() => store.set("tenant:t2:api-key", "val")).toThrow(TenantSecretBoundaryError);
    expect(() => store.delete("tenant:t2:api-key")).toThrow(TenantSecretBoundaryError);
  });

  it("throws TenantSecretBoundaryError for non-namespaced ref", () => {
    const backing = new InMemorySecretStore();
    const store = new TenantSecretStore("t1", backing);

    expect(() => store.get("api-key")).toThrow(TenantSecretBoundaryError);
  });

  it("rejects empty tenantId in constructor", () => {
    const backing = new InMemorySecretStore();
    expect(() => new TenantSecretStore("", backing)).toThrow(/non-empty/);
  });

  it("prevents cross-tenant access even with same logical ref name", () => {
    const backing = new InMemorySecretStore();
    const store1 = new TenantSecretStore("tenant-a", backing);
    const store2 = new TenantSecretStore("tenant-b", backing);

    store1.set(tenantSecretRef("tenant-a", "db-password"), "password-a");

    expect(() => store2.get(tenantSecretRef("tenant-a", "db-password"))).toThrow(
      TenantSecretBoundaryError,
    );

    expect(store2.get(tenantSecretRef("tenant-b", "db-password"))).toBeUndefined();
  });
});
