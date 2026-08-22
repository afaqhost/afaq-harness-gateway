import { describe, it, expect } from "vitest";
import {
  sanitizeRootDir,
  resolveTenantPaths,
  assertWithinTenant,
  PathContainmentError,
} from "./paths.js";

describe("sanitizeRootDir", () => {
  it("accepts an absolute path and normalizes it", () => {
    expect(sanitizeRootDir("/var/tenants/a")).toBe("/var/tenants/a");
  });

  it("normalizes trailing slash", () => {
    expect(sanitizeRootDir("/var/tenants/a/")).toBe("/var/tenants/a");
  });

  it("normalizes redundant slashes", () => {
    expect(sanitizeRootDir("/var//tenants///a")).toBe("/var/tenants/a");
  });

  it("rejects empty string", () => {
    expect(() => sanitizeRootDir("")).toThrow(PathContainmentError);
    expect(() => sanitizeRootDir("   ")).toThrow(PathContainmentError);
  });

  it("rejects null byte", () => {
    expect(() => sanitizeRootDir("/var/tenants\0/a")).toThrow(PathContainmentError);
  });

  it("rejects traversal", () => {
    expect(() => sanitizeRootDir("/var/../etc")).toThrow(PathContainmentError);
  });

  it("rejects relative path", () => {
    expect(() => sanitizeRootDir("relative/path")).toThrow(PathContainmentError);
    expect(() => sanitizeRootDir("./relative")).toThrow(PathContainmentError);
  });

  it("rejects non-string input", () => {
    expect(() => sanitizeRootDir(null as unknown as string)).toThrow(PathContainmentError);
    expect(() => sanitizeRootDir(undefined as unknown as string)).toThrow(PathContainmentError);
  });
});

describe("resolveTenantPaths", () => {
  it("returns all sub-paths under the root", () => {
    const paths = resolveTenantPaths("/var/tenants/abc");
    expect(paths.root).toBe("/var/tenants/abc");
    expect(paths.data).toBe("/var/tenants/abc/data");
    expect(paths.database).toBe("/var/tenants/abc/data/tenant.db");
    expect(paths.config).toBe("/var/tenants/abc/config");
    expect(paths.credentials).toBe("/var/tenants/abc/credentials");
    expect(paths.logs).toBe("/var/tenants/abc/logs");
    expect(paths.artifacts).toBe("/var/tenants/abc/artifacts");
  });

  it("rejects invalid root dir", () => {
    expect(() => resolveTenantPaths("../escape")).toThrow(PathContainmentError);
  });
});

describe("assertWithinTenant", () => {
  it("allows the root itself", () => {
    expect(assertWithinTenant("/var/tenants/a", "/var/tenants/a")).toBe("/var/tenants/a");
  });

  it("allows a descendant path", () => {
    expect(assertWithinTenant("/var/tenants/a", "/var/tenants/a/data/db.sqlite")).toBe(
      "/var/tenants/a/data/db.sqlite",
    );
  });

  it("rejects a sibling path", () => {
    expect(() => assertWithinTenant("/var/tenants/a", "/var/tenants/b")).toThrow(
      PathContainmentError,
    );
  });

  it("rejects a parent path", () => {
    expect(() => assertWithinTenant("/var/tenants/a", "/var/tenants")).toThrow(
      PathContainmentError,
    );
  });

  it("rejects traversal in candidate", () => {
    expect(() => assertWithinTenant("/var/tenants/a", "/var/tenants/a/../b")).toThrow(
      PathContainmentError,
    );
  });

  it("rejects absolute escape via different prefix", () => {
    expect(() => assertWithinTenant("/var/tenants/a", "/etc/passwd")).toThrow(
      PathContainmentError,
    );
  });

  it("normalizes both paths before comparing", () => {
    expect(assertWithinTenant("/var/tenants/a/", "/var//tenants/a/data")).toBe(
      "/var/tenants/a/data",
    );
  });

  it("rejects prefix-only match (tenants/abc vs tenants/abcdef)", () => {
    expect(() => assertWithinTenant("/var/tenants/abc", "/var/tenants/abcdef")).toThrow(
      PathContainmentError,
    );
  });
});
