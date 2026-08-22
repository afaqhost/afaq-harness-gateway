import { resolveTenantPaths } from "./paths.js";
import { buildTenantEnv, assertNoHostSensitiveEnv } from "./process-env.js";
import type { Tenant } from "./types.js";

export class TenantProcessIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantProcessIsolationError";
  }
}

export interface TenantSpawnOptions {
  cwd: string;
  env: Record<string, string>;
  shell: false;
  detached: true;
}

export function buildTenantSpawnOptions(
  tenant: Tenant,
  extraEnv?: Record<string, string>,
): TenantSpawnOptions {
  const paths = resolveTenantPaths(tenant.rootDir);
  return {
    cwd: paths.data,
    env: buildTenantEnv(tenant, extraEnv),
    shell: false,
    detached: true,
  };
}

export function assertTenantSpawnOptions(options: TenantSpawnOptions): void {
  if (options.shell !== false) {
    throw new TenantProcessIsolationError("Spawn options must have shell set to false");
  }
  if (options.detached !== true) {
    throw new TenantProcessIsolationError("Spawn options must have detached set to true");
  }
  try {
    assertNoHostSensitiveEnv(options.env);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Host-sensitive env detected";
    throw new TenantProcessIsolationError(message);
  }
}
