import { describe, it, expect } from "vitest";
import {
  TenantProcessIsolationError,
  buildTenantSpawnOptions,
  assertTenantSpawnOptions,
} from "./tenant-process.js";
import { createTenant } from "./types.js";

describe("buildTenantSpawnOptions", () => {
  const tenant = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });

  it("returns cwd as tenant data directory", () => {
    const opts = buildTenantSpawnOptions(tenant);
    expect(opts.cwd).toBe("/var/tenants/t1/data");
  });

  it("sets shell to false", () => {
    const opts = buildTenantSpawnOptions(tenant);
    expect(opts.shell).toBe(false);
  });

  it("sets detached to true", () => {
    const opts = buildTenantSpawnOptions(tenant);
    expect(opts.detached).toBe(true);
  });

  it("env does not contain host-sensitive keys", () => {
    const opts = buildTenantSpawnOptions(tenant);
    expect(opts.env.DOCKER_HOST).toBeUndefined();
    expect(opts.env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(opts.env.GITHUB_TOKEN).toBeUndefined();
  });

  it("env sets HOME to tenant rootDir", () => {
    const opts = buildTenantSpawnOptions(tenant);
    expect(opts.env.HOME).toBe("/var/tenants/t1");
  });

  it("merges extra env", () => {
    const opts = buildTenantSpawnOptions(tenant, { CUSTOM: "val" });
    expect(opts.env.CUSTOM).toBe("val");
  });
});

describe("assertTenantSpawnOptions", () => {
  const tenant = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });

  it("passes for valid options", () => {
    const opts = buildTenantSpawnOptions(tenant);
    expect(() => assertTenantSpawnOptions(opts)).not.toThrow();
  });

  it("throws if shell is true", () => {
    const opts = buildTenantSpawnOptions(tenant);
    expect(() =>
      assertTenantSpawnOptions({ ...opts, shell: true as unknown as false }),
    ).toThrow(TenantProcessIsolationError);
  });

  it("throws if detached is false", () => {
    const opts = buildTenantSpawnOptions(tenant);
    expect(() =>
      assertTenantSpawnOptions({ ...opts, detached: false as unknown as true }),
    ).toThrow(TenantProcessIsolationError);
  });

  it("throws if env contains host-sensitive key", () => {
    const opts = buildTenantSpawnOptions(tenant);
    expect(() =>
      assertTenantSpawnOptions({
        ...opts,
        env: { ...opts.env, DOCKER_HOST: "unix:///var/run/docker.sock" },
      }),
    ).toThrow(TenantProcessIsolationError);
  });
});
