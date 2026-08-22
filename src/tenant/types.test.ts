import { describe, it, expect } from "vitest";
import { createTenant } from "./types.js";
import type { Tenant } from "./types.js";

describe("createTenant", () => {
  it("creates a tenant with defaults", () => {
    const t = createTenant({ id: "t1", name: "Tenant One", rootDir: "/var/tenants/t1" });
    expect(t.id).toBe("t1");
    expect(t.name).toBe("Tenant One");
    expect(t.rootDir).toBe("/var/tenants/t1");
    expect(t.state).toBe("provisioning");
    expect(t.limits).toEqual({});
    expect(typeof t.createdAt).toBe("string");
    expect(t.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("accepts custom limits", () => {
    const t = createTenant({
      id: "t2",
      name: "Tenant Two",
      rootDir: "/var/tenants/t2",
      limits: { resources: { cpuQuota: 2, memoryBytes: 512_000_000 }, concurrency: { maxConcurrentRuns: 5 } },
    });
    expect(t.limits.resources?.cpuQuota).toBe(2);
    expect(t.limits.concurrency?.maxConcurrentRuns).toBe(5);
  });

  it("trims id and name", () => {
    const t = createTenant({ id: "  t3  ", name: "  Tenant Three  ", rootDir: "/var/tenants/t3" });
    expect(t.id).toBe("t3");
    expect(t.name).toBe("Tenant Three");
  });

  it("rejects empty id", () => {
    expect(() => createTenant({ id: "", name: "X", rootDir: "/var/tenants/x" })).toThrow(/non-empty/);
    expect(() => createTenant({ id: "   ", name: "X", rootDir: "/var/tenants/x" })).toThrow(/non-empty/);
  });

  it("rejects empty name", () => {
    expect(() => createTenant({ id: "t", name: "", rootDir: "/var/tenants/t" })).toThrow(/non-empty/);
  });

  it("rejects invalid rootDir", () => {
    expect(() => createTenant({ id: "t", name: "T", rootDir: "relative" })).toThrow(/absolute/);
    expect(() => createTenant({ id: "t", name: "T", rootDir: "/foo/../bar" })).toThrow(/traversal/);
  });

  it("rejects negative resource limits", () => {
    expect(() =>
      createTenant({ id: "t", name: "T", rootDir: "/var/t", limits: { resources: { cpuQuota: -1 } } }),
    ).toThrow(/non-negative/);
  });

  it("rejects negative concurrency limits", () => {
    expect(() =>
      createTenant({ id: "t", name: "T", rootDir: "/var/t", limits: { concurrency: { maxConcurrentRuns: -5 } } }),
    ).toThrow(/non-negative/);
  });

  it("accepts zero limits", () => {
    const t = createTenant({
      id: "t",
      name: "T",
      rootDir: "/var/t",
      limits: { resources: { cpuQuota: 0 }, concurrency: { queueCapacity: 0 } },
    });
    expect(t.limits.resources?.cpuQuota).toBe(0);
    expect(t.limits.concurrency?.queueCapacity).toBe(0);
  });
});
