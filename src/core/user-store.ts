import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export class UserStore {
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

  createUser(input: { username: string; passwordHash: string }): UserRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, input.username, input.passwordHash, now);
    return { id, username: input.username, password_hash: input.passwordHash, created_at: now };
  }

  getUserByUsername(username: string): UserRow | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    return row ? (row as unknown as UserRow) : undefined;
  }

  getUserById(id: string): UserRow | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ? (row as unknown as UserRow) : undefined;
  }

  listUsers(): UserRow[] {
    return this.db.prepare("SELECT * FROM users ORDER BY created_at").all() as unknown as UserRow[];
  }
}
