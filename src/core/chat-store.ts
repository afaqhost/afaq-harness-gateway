import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  run_id: string | null;
  created_at: string;
}

export interface AddMessageInput {
  id?: string;
  conversationId: string;
  role: "system" | "user" | "assistant";
  content: string;
  runId?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON conversations (updated_at DESC);
`;

export class ChatStore {
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

  createConversation(title?: string): ConversationRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    const finalTitle = title && title.trim() !== "" ? title.trim() : "New conversation";
    this.db
      .prepare(
        "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, finalTitle, now, now);
    return this.getConversation(id)!;
  }

  listConversations(): ConversationRow[] {
    return this.db
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
      .all() as unknown as ConversationRow[];
  }

  getConversation(id: string): ConversationRow | undefined {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    return row ? (row as unknown as ConversationRow) : undefined;
  }

  updateConversationTitle(id: string, title: string): ConversationRow | undefined {
    this.db
      .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, new Date().toISOString(), id);
    return this.getConversation(id);
  }

  deleteConversation(id: string): void {
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  addMessage(input: AddMessageInput): MessageRow {
    const id = input.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.conversationId, input.role, input.content, input.runId ?? null, createdAt);
    return {
      id,
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      run_id: input.runId ?? null,
      created_at: createdAt,
    };
  }

  listMessages(conversationId: string): MessageRow[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
      .all(conversationId) as unknown as MessageRow[];
  }
}
