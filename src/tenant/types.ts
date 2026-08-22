import { sanitizeRootDir } from "./paths.js";

export type TenantState = "provisioning" | "active" | "suspended" | "removed";

export interface ResourceLimits {
  cpuQuota?: number;
  memoryBytes?: number;
  storageBytes?: number;
}

export interface ConcurrencyLimits {
  maxConcurrentRuns?: number;
  queueCapacity?: number;
}

export interface TenantLimits {
  resources?: ResourceLimits;
  concurrency?: ConcurrencyLimits;
}

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly rootDir: string;
  readonly state: TenantState;
  readonly limits: TenantLimits;
  readonly createdAt: string;
}

function validateLimits(limits: TenantLimits): void {
  if (limits.resources) {
    const r = limits.resources;
    if (r.cpuQuota !== undefined && (typeof r.cpuQuota !== "number" || r.cpuQuota < 0)) {
      throw new Error("ResourceLimits.cpuQuota must be a non-negative number");
    }
    if (r.memoryBytes !== undefined && (typeof r.memoryBytes !== "number" || r.memoryBytes < 0)) {
      throw new Error("ResourceLimits.memoryBytes must be a non-negative number");
    }
    if (r.storageBytes !== undefined && (typeof r.storageBytes !== "number" || r.storageBytes < 0)) {
      throw new Error("ResourceLimits.storageBytes must be a non-negative number");
    }
  }
  if (limits.concurrency) {
    const c = limits.concurrency;
    if (c.maxConcurrentRuns !== undefined && (typeof c.maxConcurrentRuns !== "number" || c.maxConcurrentRuns < 0)) {
      throw new Error("ConcurrencyLimits.maxConcurrentRuns must be a non-negative number");
    }
    if (c.queueCapacity !== undefined && (typeof c.queueCapacity !== "number" || c.queueCapacity < 0)) {
      throw new Error("ConcurrencyLimits.queueCapacity must be a non-negative number");
    }
  }
}

export function createTenant(input: {
  id: string;
  name: string;
  rootDir: string;
  limits?: TenantLimits;
}): Tenant {
  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    throw new Error("Tenant id must be a non-empty string");
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new Error("Tenant name must be a non-empty string");
  }

  const rootDir = sanitizeRootDir(input.rootDir);
  const limits: TenantLimits = input.limits ?? {};

  validateLimits(limits);

  return {
    id: input.id.trim(),
    name: input.name.trim(),
    rootDir,
    state: "provisioning",
    limits,
    createdAt: new Date().toISOString(),
  };
}
