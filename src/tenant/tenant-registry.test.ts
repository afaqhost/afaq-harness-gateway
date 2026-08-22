import { describe, it, expect } from "vitest";
import { TenantRegistry } from "./tenant-registry.js";
import { createTenant } from "./types.js";

describe("TenantRegistry", () => {
  it("registers and retrieves a tenant", () => {
    const reg = new TenantRegistry();
    const t = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });
    reg.register(t);
    expect(reg.get("t1")).toBe(t);
    expect(reg.has("t1")).toBe(true);
  });

  it("list returns all registered tenants", () => {
    const reg = new TenantRegistry();
    const t1 = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });
    const t2 = createTenant({ id: "t2", name: "T2", rootDir: "/var/tenants/t2" });
    reg.register(t1);
    reg.register(t2);
    expect(reg.list()).toEqual([t1, t2]);
  });

  it("returns undefined for unknown id", () => {
    const reg = new TenantRegistry();
    expect(reg.get("missing")).toBeUndefined();
    expect(reg.has("missing")).toBe(false);
  });

  it("remove returns true when present, false when not", () => {
    const reg = new TenantRegistry();
    const t = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });
    reg.register(t);
    expect(reg.remove("t1")).toBe(true);
    expect(reg.has("t1")).toBe(false);
    expect(reg.remove("t1")).toBe(false);
  });

  it("throws on duplicate id", () => {
    const reg = new TenantRegistry();
    const t1 = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });
    const t1dup = createTenant({ id: "t1", name: "T1 Dup", rootDir: "/var/tenants/t1dup" });
    reg.register(t1);
    expect(() => reg.register(t1dup)).toThrow(/already registered/);
  });

  it("throws on overlapping roots (new is descendant of existing)", () => {
    const reg = new TenantRegistry();
    const t1 = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });
    reg.register(t1);
    const t2 = createTenant({ id: "t2", name: "T2", rootDir: "/var/tenants/t1/sub" });
    expect(() => reg.register(t2)).toThrow(/overlaps/);
  });

  it("throws on overlapping roots (existing is descendant of new)", () => {
    const reg = new TenantRegistry();
    const t1 = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1/sub" });
    reg.register(t1);
    const t2 = createTenant({ id: "t2", name: "T2", rootDir: "/var/tenants/t1" });
    expect(() => reg.register(t2)).toThrow(/overlaps/);
  });

  it("throws on identical roots with different ids", () => {
    const reg = new TenantRegistry();
    const t1 = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/shared" });
    const t2 = createTenant({ id: "t2", name: "T2", rootDir: "/var/tenants/shared" });
    reg.register(t1);
    expect(() => reg.register(t2)).toThrow(/overlaps/);
  });

  it("allows non-overlapping sibling roots", () => {
    const reg = new TenantRegistry();
    const t1 = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/alpha" });
    const t2 = createTenant({ id: "t2", name: "T2", rootDir: "/var/tenants/beta" });
    reg.register(t1);
    reg.register(t2);
    expect(reg.list()).toHaveLength(2);
  });

  it("rejects prefix-only overlap (abc vs abcdef)", () => {
    const reg = new TenantRegistry();
    const t1 = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/abc" });
    reg.register(t1);
    const t2 = createTenant({ id: "t2", name: "T2", rootDir: "/var/tenants/abcdef" });
    expect(() => reg.register(t2)).not.toThrow();
  });
});
