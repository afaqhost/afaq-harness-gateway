import { describe, it, expect } from "vitest";
import {
  createBackupBoundary,
  assertPathWithinBackupBoundary,
  isHostExcludedPath,
} from "./backup-boundaries.js";
import { createTenant } from "./types.js";

describe("createBackupBoundary", () => {
  it("includes tenant subdirectories", () => {
    const tenant = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });
    const boundary = createBackupBoundary(tenant);

    expect(boundary.root).toBe("/var/tenants/t1");
    expect(boundary.included).toContain("/var/tenants/t1/data");
    expect(boundary.included).toContain("/var/tenants/t1/config");
    expect(boundary.included).toContain("/var/tenants/t1/credentials");
    expect(boundary.included).toContain("/var/tenants/t1/logs");
    expect(boundary.included).toContain("/var/tenants/t1/artifacts");
  });

  it("excludes host-safety paths", () => {
    const tenant = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });
    const boundary = createBackupBoundary(tenant);

    expect(boundary.excluded).toContain("/var/run/docker.sock");
    expect(boundary.excluded).toContain("/etc");
    expect(boundary.excluded).toContain("/proc");
    expect(boundary.excluded).toContain("/sys");
    expect(boundary.excluded).toContain("/run");
    expect(boundary.excluded).toContain("/boot");
  });
});

describe("isHostExcludedPath", () => {
  it("returns true for exact excluded paths", () => {
    expect(isHostExcludedPath("/etc")).toBe(true);
    expect(isHostExcludedPath("/proc")).toBe(true);
    expect(isHostExcludedPath("/sys")).toBe(true);
    expect(isHostExcludedPath("/run")).toBe(true);
    expect(isHostExcludedPath("/boot")).toBe(true);
    expect(isHostExcludedPath("/var/run/docker.sock")).toBe(true);
  });

  it("returns true for descendants of excluded paths", () => {
    expect(isHostExcludedPath("/etc/passwd")).toBe(true);
    expect(isHostExcludedPath("/proc/1/status")).toBe(true);
    expect(isHostExcludedPath("/sys/class/net")).toBe(true);
  });

  it("returns false for non-excluded paths", () => {
    expect(isHostExcludedPath("/var/tenants/t1")).toBe(false);
    expect(isHostExcludedPath("/home/user")).toBe(false);
    expect(isHostExcludedPath("/tmp")).toBe(false);
  });
});

describe("assertPathWithinBackupBoundary", () => {
  const tenant = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });

  it("allows tenant-local paths", () => {
    expect(assertPathWithinBackupBoundary(tenant, "/var/tenants/t1/data")).toBe(
      "/var/tenants/t1/data",
    );
  });

  it("rejects host-excluded paths", () => {
    expect(() => assertPathWithinBackupBoundary(tenant, "/etc/passwd")).toThrow(
      /host-excluded/,
    );
  });

  it("rejects paths outside tenant root", () => {
    expect(() => assertPathWithinBackupBoundary(tenant, "/var/tenants/t2/data")).toThrow();
  });
});
