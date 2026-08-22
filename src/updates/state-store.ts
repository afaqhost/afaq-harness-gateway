import { DatabaseSync } from "node:sqlite";
import type { CompatibilityStatus, VersionState } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS version_states (
  definition_id TEXT PRIMARY KEY,
  installed_version TEXT NOT NULL,
  latest_known_version TEXT,
  compatibility_status TEXT NOT NULL,
  known_good_version TEXT,
  notes TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT NOT NULL
);
`;

export class VersionStateStore {
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

  upsert(input: {
    definitionId: string;
    installedVersion: string;
    latestKnownVersion?: string;
    compatibilityStatus: CompatibilityStatus;
    knownGoodVersion?: string;
    notes?: readonly string[];
  }): VersionState {
    const now = new Date().toISOString();
    const notes = JSON.stringify(input.notes ?? []);

    this.db
      .prepare(
        `INSERT INTO version_states (definition_id, installed_version, latest_known_version, compatibility_status, known_good_version, notes, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(definition_id) DO UPDATE SET
           installed_version = excluded.installed_version,
           latest_known_version = excluded.latest_known_version,
           compatibility_status = excluded.compatibility_status,
           known_good_version = excluded.known_good_version,
           notes = excluded.notes,
           checked_at = excluded.checked_at`,
      )
      .run(
        input.definitionId,
        input.installedVersion,
        input.latestKnownVersion ?? null,
        input.compatibilityStatus,
        input.knownGoodVersion ?? null,
        notes,
        now,
      );

    return this.get(input.definitionId)!;
  }

  get(definitionId: string): VersionState | undefined {
    const row = this.db
      .prepare("SELECT * FROM version_states WHERE definition_id = ?")
      .get(definitionId);
    return row ? toVersionState(row) : undefined;
  }

  list(): VersionState[] {
    const rows = this.db
      .prepare("SELECT * FROM version_states ORDER BY definition_id")
      .all();
    return (rows as unknown[]).map(toVersionState);
  }
}

function toVersionState(row: unknown): VersionState {
  const r = row as Record<string, unknown>;
  return {
    definitionId: r.definition_id as string,
    installedVersion: r.installed_version as string,
    latestKnownVersion: (r.latest_known_version as string | null) ?? undefined,
    compatibilityStatus: r.compatibility_status as CompatibilityStatus,
    knownGoodVersion: (r.known_good_version as string | null) ?? undefined,
    notes: JSON.parse(r.notes as string) as string[],
    checkedAt: r.checked_at as string,
  };
}
