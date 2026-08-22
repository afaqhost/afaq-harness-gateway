import { describe, it, expect } from "vitest";
import { TenantResourceGuard, TenantLimitError } from "./resource-guard.js";
import { createTenant } from "./types.js";

describe("TenantResourceGuard", () => {
  const guard = new TenantResourceGuard();

  describe("assertCpuQuota", () => {
    it("passes when under limit", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { cpuQuota: 4 } } });
      expect(() => guard.assertCpuQuota(t, 3)).not.toThrow();
    });

    it("passes when at limit", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { cpuQuota: 4 } } });
      expect(() => guard.assertCpuQuota(t, 4)).not.toThrow();
    });

    it("throws TenantLimitError when exceeded", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { cpuQuota: 2 } } });
      expect(() => guard.assertCpuQuota(t, 3)).toThrow(TenantLimitError);
      expect(() => guard.assertCpuQuota(t, 3)).toThrow(/cpu_exceeded|CPU quota/);
    });

    it("allows when limit is undefined", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t" });
      expect(() => guard.assertCpuQuota(t, 999)).not.toThrow();
    });

    it("allows when limit is zero", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { cpuQuota: 0 } } });
      expect(() => guard.assertCpuQuota(t, 999)).not.toThrow();
    });
  });

  describe("assertMemory", () => {
    it("passes when under limit", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { memoryBytes: 1000 } } });
      expect(() => guard.assertMemory(t, 999)).not.toThrow();
    });

    it("throws TenantLimitError when exceeded", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { memoryBytes: 512 } } });
      expect(() => guard.assertMemory(t, 1024)).toThrow(TenantLimitError);
      expect(() => guard.assertMemory(t, 1024)).toThrow(/memory_exceeded|Memory limit/);
    });

    it("allows when limit is undefined", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t" });
      expect(() => guard.assertMemory(t, 999_999)).not.toThrow();
    });

    it("allows when limit is zero", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { memoryBytes: 0 } } });
      expect(() => guard.assertMemory(t, 999_999)).not.toThrow();
    });
  });

  describe("assertStorage", () => {
    it("passes when under limit", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { storageBytes: 10_000 } } });
      expect(() => guard.assertStorage(t, 9_999)).not.toThrow();
    });

    it("throws TenantLimitError when exceeded", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { storageBytes: 5000 } } });
      expect(() => guard.assertStorage(t, 5001)).toThrow(TenantLimitError);
      expect(() => guard.assertStorage(t, 5001)).toThrow(/storage_exceeded|Storage limit/);
    });

    it("allows when limit is undefined", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t" });
      expect(() => guard.assertStorage(t, 999_999)).not.toThrow();
    });

    it("allows when limit is zero", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { storageBytes: 0 } } });
      expect(() => guard.assertStorage(t, 999_999)).not.toThrow();
    });
  });

  describe("assertConcurrency", () => {
    it("passes when under limit", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { concurrency: { maxConcurrentRuns: 5 } } });
      expect(() => guard.assertConcurrency(t, 4)).not.toThrow();
    });

    it("throws TenantLimitError when exceeded", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { concurrency: { maxConcurrentRuns: 3 } } });
      expect(() => guard.assertConcurrency(t, 4)).toThrow(TenantLimitError);
      expect(() => guard.assertConcurrency(t, 4)).toThrow(/concurrency_exceeded|Concurrency limit/);
    });

    it("allows when limit is undefined", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t" });
      expect(() => guard.assertConcurrency(t, 999)).not.toThrow();
    });

    it("allows when limit is zero", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { concurrency: { maxConcurrentRuns: 0 } } });
      expect(() => guard.assertConcurrency(t, 999)).not.toThrow();
    });
  });

  describe("assertQueueDepth", () => {
    it("passes when under limit", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { concurrency: { queueCapacity: 10 } } });
      expect(() => guard.assertQueueDepth(t, 9)).not.toThrow();
    });

    it("throws TenantLimitError when exceeded", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { concurrency: { queueCapacity: 5 } } });
      expect(() => guard.assertQueueDepth(t, 6)).toThrow(TenantLimitError);
      expect(() => guard.assertQueueDepth(t, 6)).toThrow(/queue_exceeded|Queue capacity/);
    });

    it("allows when limit is undefined", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t" });
      expect(() => guard.assertQueueDepth(t, 999)).not.toThrow();
    });

    it("allows when limit is zero", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { concurrency: { queueCapacity: 0 } } });
      expect(() => guard.assertQueueDepth(t, 999)).not.toThrow();
    });
  });

  describe("TenantLimitError", () => {
    it("has the correct code and name", () => {
      const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t", limits: { resources: { cpuQuota: 1 } } });
      try {
        guard.assertCpuQuota(t, 2);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TenantLimitError);
        expect((err as TenantLimitError).code).toBe("cpu_exceeded");
        expect((err as TenantLimitError).name).toBe("TenantLimitError");
      }
    });
  });
});
