import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TenantHealthService } from "./tenant-health.js";
import { createTenant } from "./types.js";
import { ensureTenantStorage } from "./tenant-store.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tenant-health-test-"));
}

describe("TenantHealthService", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns ok: true when all checks pass", () => {
    tmpDir = makeTmpDir();
    const rootDir = path.join(tmpDir, "tenant-h");
    const tenant = createTenant({ id: "h", name: "H", rootDir });
    ensureTenantStorage(tenant);

    const svc = new TenantHealthService();
    const health = svc.check(tenant);

    expect(health.ok).toBe(true);
    expect(health.message).toBeUndefined();
    expect(health.details.storageExists).toBe(true);
    expect(health.details.isolationPolicySafe).toBe(true);
    expect(health.details.envSafe).toBe(true);
    expect(health.details.databasePath).toBe(path.join(rootDir, "data", "tenant.db"));
  });

  it("returns ok: false when storage directories are missing", () => {
    tmpDir = makeTmpDir();
    const rootDir = path.join(tmpDir, "tenant-missing");
    const tenant = createTenant({ id: "m", name: "M", rootDir });

    const svc = new TenantHealthService();
    const health = svc.check(tenant);

    expect(health.ok).toBe(false);
    expect(health.message).toContain("storage directories missing");
    expect(health.details.storageExists).toBe(false);
  });

  it("never throws for a valid tenant with missing storage", () => {
    tmpDir = makeTmpDir();
    const rootDir = path.join(tmpDir, "tenant-nothrow");
    const tenant = createTenant({ id: "n", name: "N", rootDir });

    const svc = new TenantHealthService();
    expect(() => svc.check(tenant)).not.toThrow();
  });
});
