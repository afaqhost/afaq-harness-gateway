import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  prefix: string;
  enabled: number;
  model_allowlist_json: string | null;
  rpm_limit: number | null;
  max_concurrency: number | null;
  monthly_budget_usd: number | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateApiKeyInput {
  name: string;
  keyHash: string;
  prefix: string;
  modelAllowlistJson?: string;
  rpmLimit?: number;
  maxConcurrency?: number;
  monthlyBudgetUsd?: number;
  expiresAt?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  model_allowlist_json TEXT,
  rpm_limit INTEGER,
  max_concurrency INTEGER,
  monthly_budget_usd REAL,
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export class ApiKeyStore {
  private db: DatabaseSync;

  constructor(location: string = ":memory:") {
    this.db = new DatabaseSync(location);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  createKey(input: CreateApiKeyInput): ApiKeyRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO api_keys
         (id, name, key_hash, prefix, enabled, model_allowlist_json, rpm_limit, max_concurrency, monthly_budget_usd, expires_at, last_used_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.keyHash,
        input.prefix,
        input.modelAllowlistJson ?? null,
        input.rpmLimit ?? null,
        input.maxConcurrency ?? null,
        input.monthlyBudgetUsd ?? null,
        input.expiresAt ?? null,
        now,
        now,
      );
    return this.getKeyById(id)!;
  }

  getKeyById(id: string): ApiKeyRow | undefined {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id);
    return row ? (row as unknown as ApiKeyRow) : undefined;
  }

  getKeyByHash(keyHash: string): ApiKeyRow | undefined {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(keyHash);
    return row ? (row as unknown as ApiKeyRow) : undefined;
  }

  listKeys(): ApiKeyRow[] {
    return this.db.prepare("SELECT * FROM api_keys ORDER BY created_at").all() as unknown as ApiKeyRow[];
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare("UPDATE api_keys SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, new Date().toISOString(), id);
  }

  setLastUsed(id: string): void {
    this.db
      .prepare("UPDATE api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), id);
  }

  deleteKey(id: string): void {
    this.db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
  }
}
