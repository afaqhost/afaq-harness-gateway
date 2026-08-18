import { DatabaseSync } from "node:sqlite";

export interface SessionRow {
  token: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

export class SessionStore {
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

  createSession(input: { token: string; userId: string; expiresAt: string }): SessionRow {
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(input.token, input.userId, now, input.expiresAt);
    return { token: input.token, user_id: input.userId, created_at: now, expires_at: input.expiresAt };
  }

  getSession(token: string): SessionRow | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
    return row ? (row as unknown as SessionRow) : undefined;
  }

  deleteSession(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }

  deleteExpired(nowIso: string): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso);
  }
}
