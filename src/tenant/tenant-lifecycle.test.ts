import { describe, it, expect } from "vitest";
import { transitionTenantState, TenantLifecycle } from "./tenant-lifecycle.js";
import { createTenant } from "./types.js";

function makeTenant(id = "t1") {
  return createTenant({ id, name: `Tenant ${id}`, rootDir: `/var/tenants/${id}` });
}

describe("transitionTenantState", () => {
  it("provisioning -> active on activate", () => {
    expect(transitionTenantState("provisioning", "activate")).toBe("active");
  });

  it("provisioning -> removed on remove", () => {
    expect(transitionTenantState("provisioning", "remove")).toBe("removed");
  });

  it("active -> suspended on suspend", () => {
    expect(transitionTenantState("active", "suspend")).toBe("suspended");
  });

  it("active -> removed on remove", () => {
    expect(transitionTenantState("active", "remove")).toBe("removed");
  });

  it("suspended -> active on resume", () => {
    expect(transitionTenantState("suspended", "resume")).toBe("active");
  });

  it("suspended -> removed on remove", () => {
    expect(transitionTenantState("suspended", "remove")).toBe("removed");
  });

  it("throws on invalid transition: provisioning + suspend", () => {
    expect(() => transitionTenantState("provisioning", "suspend")).toThrow("invalid tenant transition: provisioning + suspend");
  });

  it("throws on invalid transition: provisioning + resume", () => {
    expect(() => transitionTenantState("provisioning", "resume")).toThrow("invalid tenant transition: provisioning + resume");
  });

  it("throws on invalid transition: active + activate", () => {
    expect(() => transitionTenantState("active", "activate")).toThrow("invalid tenant transition: active + activate");
  });

  it("throws on invalid transition: active + resume", () => {
    expect(() => transitionTenantState("active", "resume")).toThrow("invalid tenant transition: active + resume");
  });

  it("throws on invalid transition: suspended + activate", () => {
    expect(() => transitionTenantState("suspended", "activate")).toThrow("invalid tenant transition: suspended + activate");
  });

  it("throws on invalid transition: suspended + suspend", () => {
    expect(() => transitionTenantState("suspended", "suspend")).toThrow("invalid tenant transition: suspended + suspend");
  });

  it("removed has no outgoing transitions", () => {
    for (const event of ["provision", "activate", "suspend", "resume", "remove"] as const) {
      expect(() => transitionTenantState("removed", event)).toThrow(`invalid tenant transition: removed + ${event}`);
    }
  });
});

describe("TenantLifecycle", () => {
  it("provisions a tenant in provisioning state", () => {
    const lc = new TenantLifecycle();
    const t = makeTenant();
    expect(lc.provision(t)).toBe("provisioning");
    expect(lc.state("t1")).toBe("provisioning");
  });

  it("throws on duplicate provision", () => {
    const lc = new TenantLifecycle();
    const t = makeTenant();
    lc.provision(t);
    expect(() => lc.provision(t)).toThrow('tenant "t1" already exists');
  });

  it("does not mutate the passed-in tenant object", () => {
    const lc = new TenantLifecycle();
    const t = makeTenant();
    const originalState = t.state;
    lc.provision(t);
    lc.activate("t1");
    expect(t.state).toBe(originalState);
  });

  it("activate transitions provisioning -> active", () => {
    const lc = new TenantLifecycle();
    lc.provision(makeTenant());
    expect(lc.activate("t1")).toBe("active");
    expect(lc.state("t1")).toBe("active");
  });

  it("suspend transitions active -> suspended", () => {
    const lc = new TenantLifecycle();
    lc.provision(makeTenant());
    lc.activate("t1");
    expect(lc.suspend("t1")).toBe("suspended");
    expect(lc.state("t1")).toBe("suspended");
  });

  it("resume transitions suspended -> active", () => {
    const lc = new TenantLifecycle();
    lc.provision(makeTenant());
    lc.activate("t1");
    lc.suspend("t1");
    expect(lc.resume("t1")).toBe("active");
    expect(lc.state("t1")).toBe("active");
  });

  it("remove transitions active -> removed", () => {
    const lc = new TenantLifecycle();
    lc.provision(makeTenant());
    lc.activate("t1");
    expect(lc.remove("t1")).toBe("removed");
    expect(lc.state("t1")).toBe("removed");
  });

  it("remove transitions provisioning -> removed", () => {
    const lc = new TenantLifecycle();
    lc.provision(makeTenant());
    expect(lc.remove("t1")).toBe("removed");
  });

  it("remove transitions suspended -> removed", () => {
    const lc = new TenantLifecycle();
    lc.provision(makeTenant());
    lc.activate("t1");
    lc.suspend("t1");
    expect(lc.remove("t1")).toBe("removed");
  });

  it("throws on invalid lifecycle event from current state", () => {
    const lc = new TenantLifecycle();
    lc.provision(makeTenant());
    expect(() => lc.suspend("t1")).toThrow("invalid tenant transition");
  });

  it("throws on unknown tenant id for state()", () => {
    const lc = new TenantLifecycle();
    expect(() => lc.state("missing")).toThrow('unknown tenant "missing"');
  });

  it("throws on unknown tenant id for activate()", () => {
    const lc = new TenantLifecycle();
    expect(() => lc.activate("missing")).toThrow('unknown tenant "missing"');
  });

  it("throws on unknown tenant id for suspend()", () => {
    const lc = new TenantLifecycle();
    expect(() => lc.suspend("missing")).toThrow('unknown tenant "missing"');
  });

  it("throws on unknown tenant id for resume()", () => {
    const lc = new TenantLifecycle();
    expect(() => lc.resume("missing")).toThrow('unknown tenant "missing"');
  });

  it("throws on unknown tenant id for remove()", () => {
    const lc = new TenantLifecycle();
    expect(() => lc.remove("missing")).toThrow('unknown tenant "missing"');
  });

  it("removed tenant cannot be transitioned further", () => {
    const lc = new TenantLifecycle();
    lc.provision(makeTenant());
    lc.activate("t1");
    lc.remove("t1");
    expect(() => lc.activate("t1")).toThrow("invalid tenant transition");
  });
});
