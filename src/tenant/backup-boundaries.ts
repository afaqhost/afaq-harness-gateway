import { normalize } from "node:path";
import { resolveTenantPaths, assertWithinTenant } from "./paths.js";
import type { Tenant } from "./types.js";

const HOST_EXCLUDED_PATHS: readonly string[] = [
  "/var/run/docker.sock",
  "/etc",
  "/proc",
  "/sys",
  "/run",
  "/boot",
];

export interface BackupBoundary {
  readonly included: readonly string[];
  readonly excluded: readonly string[];
  readonly root: string;
}

export function createBackupBoundary(tenant: Tenant): BackupBoundary {
  const paths = resolveTenantPaths(tenant.rootDir);
  return {
    included: [paths.data, paths.config, paths.credentials, paths.logs, paths.artifacts],
    excluded: [...HOST_EXCLUDED_PATHS],
    root: paths.root,
  };
}

export function isHostExcludedPath(candidate: string): boolean {
  const normalized = normalize(candidate);
  for (const excluded of HOST_EXCLUDED_PATHS) {
    if (normalized === excluded) return true;
    const prefix = excluded.endsWith("/") ? excluded : excluded + "/";
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

export function assertPathWithinBackupBoundary(tenant: Tenant, candidate: string): string {
  if (isHostExcludedPath(candidate)) {
    throw new Error(`Path "${candidate}" is in the host-excluded list and cannot be backed up`);
  }
  return assertWithinTenant(tenant.rootDir, candidate);
}
