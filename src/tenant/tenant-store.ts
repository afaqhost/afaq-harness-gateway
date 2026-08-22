import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveTenantPaths, assertWithinTenant } from "./paths.js";
import type { Tenant } from "./types.js";
import type { TenantPaths } from "./paths.js";

export class TenantStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantStoreError";
  }
}

export function ensureTenantStorage(tenant: Tenant): TenantPaths {
  const paths = resolveTenantPaths(tenant.rootDir);
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.data, { recursive: true });
  mkdirSync(paths.config, { recursive: true });
  mkdirSync(paths.credentials, { recursive: true });
  mkdirSync(paths.logs, { recursive: true });
  mkdirSync(paths.artifacts, { recursive: true });
  return paths;
}

export function assertDatabasePathWithinTenant(tenant: Tenant, databasePath: string): string {
  return assertWithinTenant(tenant.rootDir, databasePath);
}

export class TenantStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS tenant_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
  }

  set(key: string, value: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new TenantStoreError("key must be a non-empty string");
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new TenantStoreError("value must be a non-empty string");
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO tenant_kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(key, value, now);
  }

  get(key: string): string | undefined {
    if (typeof key !== "string" || key.length === 0) {
      throw new TenantStoreError("key must be a non-empty string");
    }
    const row = this.db.prepare("SELECT value FROM tenant_kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  delete(key: string): boolean {
    if (typeof key !== "string" || key.length === 0) {
      throw new TenantStoreError("key must be a non-empty string");
    }
    const result = this.db.prepare("DELETE FROM tenant_kv WHERE key = ?").run(key);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export function openTenantStore(tenant: Tenant): TenantStore {
  const paths = resolveTenantPaths(tenant.rootDir);
  ensureTenantStorage(tenant);
  return new TenantStore(assertDatabasePathWithinTenant(tenant, paths.database));
}
