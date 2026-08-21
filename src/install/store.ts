import { DatabaseSync } from "node:sqlite";
import type { InstallRecord, InstallRecordState, InstallStrategyName } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS install_records (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL,
  path TEXT NOT NULL,
  version TEXT NOT NULL,
  strategy TEXT NOT NULL,
  state TEXT NOT NULL,
  checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_install_records_definition_id ON install_records (definition_id);
`;

export class InstallStore {
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

  createRecord(input: {
    id: string;
    definitionId: string;
    path: string;
    version: string;
    strategy: InstallStrategyName;
    state?: InstallRecordState;
    checksum?: string;
  }): InstallRecord {
    const now = new Date().toISOString();
    const state = input.state ?? "pending";
    this.db
      .prepare(
        `INSERT INTO install_records (id, definition_id, path, version, strategy, state, checksum, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.definitionId,
        input.path,
        input.version,
        input.strategy,
        state,
        input.checksum ?? null,
        now,
        now,
      );
    return this.getRecord(input.id)!;
  }

  getRecord(id: string): InstallRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM install_records WHERE id = ?")
      .get(id);
    return row ? toRecord(row) : undefined;
  }

  listRecords(): InstallRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM install_records ORDER BY created_at")
      .all();
    return (rows as unknown[]).map(toRecord);
  }

  listByDefinition(definitionId: string): InstallRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM install_records WHERE definition_id = ? ORDER BY created_at",
      )
      .all(definitionId);
    return (rows as unknown[]).map(toRecord);
  }

  updateState(id: string, state: InstallRecordState): InstallRecord | undefined {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE install_records SET state = ?, updated_at = ? WHERE id = ?")
      .run(state, now, id);
    return this.getRecord(id);
  }

  updateVersion(id: string, version: string): InstallRecord | undefined {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE install_records SET version = ?, updated_at = ? WHERE id = ?")
      .run(version, now, id);
    return this.getRecord(id);
  }

  removeRecord(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM install_records WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }
}

function toRecord(row: unknown): InstallRecord {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    definitionId: r.definition_id as string,
    path: r.path as string,
    version: r.version as string,
    strategy: r.strategy as InstallStrategyName,
    state: r.state as InstallRecordState,
    checksum: (r.checksum as string | null) ?? undefined,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}
