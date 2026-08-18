import { DatabaseSync } from "node:sqlite";

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "rejected";

export interface RunRow {
  id: string;
  requested_model: string;
  resolved_model: string | null;
  harness: string | null;
  status: RunStatus;
  session_id: string | null;
  error_message: string | null;
  usage_json: string | null;
  api_key_id: string | null;
  estimated_cost_usd: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface RunEventRow {
  id: number;
  run_id: string;
  seq: number;
  type: string;
  payload_json: string;
  created_at: string;
}

export interface CreateRunInput {
  id: string;
  requestedModel: string;
  resolvedModel?: string;
  harness?: string;
  apiKeyId?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  requested_model TEXT NOT NULL,
  resolved_model TEXT,
  harness TEXT,
  status TEXT NOT NULL,
  session_id TEXT,
  error_message TEXT,
  usage_json TEXT,
  api_key_id TEXT,
  estimated_cost_usd REAL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_id_seq ON run_events (run_id, seq);

CREATE TABLE IF NOT EXISTS model_aliases (
  alias TEXT PRIMARY KEY,
  canonical_model TEXT NOT NULL
);
`;

export class RunStore {
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

  createRun(input: CreateRunInput): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, requested_model, resolved_model, harness, api_key_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
      )
      .run(input.id, input.requestedModel, input.resolvedModel ?? null, input.harness ?? null, input.apiKeyId ?? null, new Date().toISOString());
  }

  getRun(id: string): RunRow | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
    return row ? (row as unknown as RunRow) : undefined;
  }

  listRuns(): RunRow[] {
    return this.db.prepare("SELECT * FROM runs ORDER BY created_at").all() as unknown as RunRow[];
  }

  markStarted(id: string): void {
    this.db
      .prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  markFinished(id: string, status: RunStatus, errorMessage?: string): void {
    const startedAt = this.getRun(id)?.started_at ?? null;
    const durationMs =
      startedAt != null
        ? Date.now() - new Date(startedAt).getTime()
        : null;
    this.db
      .prepare(
        `UPDATE runs
         SET status = ?, error_message = ?, finished_at = ?, duration_ms = ?
         WHERE id = ?`,
      )
      .run(status, errorMessage ?? null, new Date().toISOString(), durationMs, id);
  }

  updateRunMeta(id: string, meta: { sessionId?: string | null; usageJson?: string | null; estimatedCostUsd?: number | null }): void {
    this.db
      .prepare("UPDATE runs SET session_id = COALESCE(?, session_id), usage_json = COALESCE(?, usage_json), estimated_cost_usd = ? WHERE id = ?")
      .run(meta.sessionId ?? null, meta.usageJson ?? null, meta.estimatedCostUsd ?? null, id);
  }

  sumEstimatedCostSince(keyId: string, sinceIso: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total FROM runs WHERE api_key_id = ? AND created_at >= ?")
      .get(keyId, sinceIso);
    return Number(row?.total ?? 0);
  }

  appendEvent(id: string, type: string, payload: unknown): void {
    const seq = this.nextEventSeq(id);
    this.db
      .prepare(
        `INSERT INTO run_events (run_id, seq, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, seq, type, JSON.stringify(payload), new Date().toISOString());
  }

  listEvents(runId: string): RunEventRow[] {
    return this.db
      .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY seq")
      .all(runId) as unknown as RunEventRow[];
  }

  setAlias(alias: string, canonicalModel: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO model_aliases (alias, canonical_model) VALUES (?, ?)")
      .run(alias, canonicalModel);
  }

  getAlias(alias: string): string | undefined {
    const row = this.db.prepare("SELECT canonical_model FROM model_aliases WHERE alias = ?").get(alias);
    return row ? (row.canonical_model as string) : undefined;
  }

  private nextEventSeq(runId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM run_events WHERE run_id = ?")
      .get(runId);
    return Number(row?.maxSeq ?? 0) + 1;
  }
}
