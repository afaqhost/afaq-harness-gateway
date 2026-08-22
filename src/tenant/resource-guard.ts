import type { Tenant } from "./types.js";

export class TenantLimitError extends Error {
  constructor(
    public readonly code: "cpu_exceeded" | "memory_exceeded" | "storage_exceeded" | "concurrency_exceeded" | "queue_exceeded",
    message: string,
  ) {
    super(message);
    this.name = "TenantLimitError";
  }
}

export class TenantResourceGuard {
  assertCpuQuota(tenant: Tenant, requestedCpu: number): void {
    const limit = tenant.limits.resources?.cpuQuota;
    if (limit === undefined || limit <= 0) return;
    if (requestedCpu > limit) {
      throw new TenantLimitError("cpu_exceeded", `CPU quota of ${limit} exceeded (requested ${requestedCpu}) for tenant "${tenant.id}".`);
    }
  }

  assertMemory(tenant: Tenant, requestedBytes: number): void {
    const limit = tenant.limits.resources?.memoryBytes;
    if (limit === undefined || limit <= 0) return;
    if (requestedBytes > limit) {
      throw new TenantLimitError("memory_exceeded", `Memory limit of ${limit} bytes exceeded (requested ${requestedBytes}) for tenant "${tenant.id}".`);
    }
  }

  assertStorage(tenant: Tenant, currentBytes: number): void {
    const limit = tenant.limits.resources?.storageBytes;
    if (limit === undefined || limit <= 0) return;
    if (currentBytes > limit) {
      throw new TenantLimitError("storage_exceeded", `Storage limit of ${limit} bytes exceeded (current ${currentBytes}) for tenant "${tenant.id}".`);
    }
  }

  assertConcurrency(tenant: Tenant, current: number): void {
    const limit = tenant.limits.concurrency?.maxConcurrentRuns;
    if (limit === undefined || limit <= 0) return;
    if (current > limit) {
      throw new TenantLimitError("concurrency_exceeded", `Concurrency limit of ${limit} exceeded (current ${current}) for tenant "${tenant.id}".`);
    }
  }

  assertQueueDepth(tenant: Tenant, current: number): void {
    const limit = tenant.limits.concurrency?.queueCapacity;
    if (limit === undefined || limit <= 0) return;
    if (current > limit) {
      throw new TenantLimitError("queue_exceeded", `Queue capacity of ${limit} exceeded (current ${current}) for tenant "${tenant.id}".`);
    }
  }
}
