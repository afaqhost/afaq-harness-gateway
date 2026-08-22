import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  TenantStoreError,
  ensureTenantStorage,
  assertDatabasePathWithinTenant,
  TenantStore,
  openTenantStore,
} from "./tenant-store.js";
import { createTenant } from "./types.js";
import { resolveTenantPaths } from "./paths.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tenant-store-test-"));
}

describe("ensureTenantStorage", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates all tenant directories", () => {
    tmpDir = makeTmpDir();
    const rootDir = path.join(tmpDir, "tenant-a");
    const tenant = createTenant({ id: "a", name: "A", rootDir });
    const paths = ensureTenantStorage(tenant);

    expect(fs.existsSync(paths.root)).toBe(true);
    expect(fs.existsSync(paths.data)).toBe(true);
    expect(fs.existsSync(paths.config)).toBe(true);
    expect(fs.existsSync(paths.credentials)).toBe(true);
    expect(fs.existsSync(paths.logs)).toBe(true);
    expect(fs.existsSync(paths.artifacts)).toBe(true);
  });

  it("returns TenantPaths", () => {
    tmpDir = makeTmpDir();
    const rootDir = path.join(tmpDir, "tenant-b");
    const tenant = createTenant({ id: "b", name: "B", rootDir });
    const paths = ensureTenantStorage(tenant);
    const expected = resolveTenantPaths(rootDir);
    expect(paths).toEqual(expected);
  });

  it("does not throw if directories already exist", () => {
    tmpDir = makeTmpDir();
    const rootDir = path.join(tmpDir, "tenant-c");
    const tenant = createTenant({ id: "c", name: "C", rootDir });
    ensureTenantStorage(tenant);
    expect(() => ensureTenantStorage(tenant)).not.toThrow();
  });
});

describe("assertDatabasePathWithinTenant", () => {
  it("returns the normalized path when within tenant", () => {
    const tenant = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });
    expect(assertDatabasePathWithinTenant(tenant, "/var/tenants/t1/data/tenant.db")).toBe(
      "/var/tenants/t1/data/tenant.db",
    );
  });

  it("throws for a path outside the tenant", () => {
    const tenant = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });
    expect(() => assertDatabasePathWithinTenant(tenant, "/etc/passwd")).toThrow();
  });
});

describe("TenantStore", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("opens, sets, gets, deletes, and closes", () => {
    tmpDir = makeTmpDir();
    const dbPath = path.join(tmpDir, "test.db");
    const store = new TenantStore(dbPath);

    store.set("key1", "value1");
    expect(store.get("key1")).toBe("value1");

    store.set("key1", "updated");
    expect(store.get("key1")).toBe("updated");

    expect(store.get("missing")).toBeUndefined();

    expect(store.delete("key1")).toBe(true);
    expect(store.get("key1")).toBeUndefined();
    expect(store.delete("key1")).toBe(false);

    store.close();
  });

  it("throws TenantStoreError for empty key", () => {
    tmpDir = makeTmpDir();
    const dbPath = path.join(tmpDir, "test.db");
    const store = new TenantStore(dbPath);

    expect(() => store.set("", "val")).toThrow(TenantStoreError);
    expect(() => store.get("")).toThrow(TenantStoreError);
    expect(() => store.delete("")).toThrow(TenantStoreError);

    store.close();
  });

  it("throws TenantStoreError for empty value", () => {
    tmpDir = makeTmpDir();
    const dbPath = path.join(tmpDir, "test.db");
    const store = new TenantStore(dbPath);

    expect(() => store.set("key", "")).toThrow(TenantStoreError);

    store.close();
  });

  it("persists data across instances", () => {
    tmpDir = makeTmpDir();
    const dbPath = path.join(tmpDir, "test.db");

    const store1 = new TenantStore(dbPath);
    store1.set("persist", "data");
    store1.close();

    const store2 = new TenantStore(dbPath);
    expect(store2.get("persist")).toBe("data");
    store2.close();
  });
});

describe("openTenantStore", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates storage and opens a store within the tenant", () => {
    tmpDir = makeTmpDir();
    const rootDir = path.join(tmpDir, "tenant-x");
    const tenant = createTenant({ id: "x", name: "X", rootDir });
    const store = openTenantStore(tenant);

    store.set("hello", "world");
    expect(store.get("hello")).toBe("world");
    store.close();

    const paths = resolveTenantPaths(rootDir);
    expect(fs.existsSync(paths.database)).toBe(true);
  });
});
