import { existsSync } from "node:fs";
import { resolveTenantPaths } from "./paths.js";
import { assertDatabasePathWithinTenant } from "./tenant-store.js";
import { assertIsolationPolicy, DEFAULT_ISOLATION_POLICY } from "./isolation.js";
import { buildTenantEnv, assertNoHostSensitiveEnv } from "./process-env.js";
import type { Tenant } from "./types.js";

export interface TenantHealthDetails {
  storageExists: boolean;
  databasePath: string;
  isolationPolicySafe: boolean;
  envSafe: boolean;
}

export interface TenantHealth {
  ok: boolean;
  message?: string;
  details: TenantHealthDetails;
}

export class TenantHealthService {
  check(tenant: Tenant): TenantHealth {
    const paths = resolveTenantPaths(tenant.rootDir);

    const storageExists =
      existsSync(paths.root) &&
      existsSync(paths.data) &&
      existsSync(paths.config) &&
      existsSync(paths.credentials) &&
      existsSync(paths.logs) &&
      existsSync(paths.artifacts);

    let databasePathOk = false;
    try {
      assertDatabasePathWithinTenant(tenant, paths.database);
      databasePathOk = true;
    } catch {
      // containment check failed
    }

    let isolationPolicySafe = false;
    try {
      assertIsolationPolicy(DEFAULT_ISOLATION_POLICY);
      isolationPolicySafe = true;
    } catch {
      // policy check failed
    }

    let envSafe = false;
    try {
      assertNoHostSensitiveEnv(buildTenantEnv(tenant));
      envSafe = true;
    } catch {
      // env check failed
    }

    const details: TenantHealthDetails = {
      storageExists,
      databasePath: paths.database,
      isolationPolicySafe,
      envSafe,
    };

    const ok = storageExists && databasePathOk && isolationPolicySafe && envSafe;

    if (!ok) {
      const failures: string[] = [];
      if (!storageExists) failures.push("storage directories missing");
      if (!databasePathOk) failures.push("database path outside tenant");
      if (!isolationPolicySafe) failures.push("isolation policy violated");
      if (!envSafe) failures.push("host-sensitive env detected");
      return { ok: false, message: failures.join("; "), details };
    }

    return { ok: true, details };
  }
}
