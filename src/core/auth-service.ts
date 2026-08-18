import { randomBytes } from "node:crypto";
import { generateApiKey, hashApiKey } from "./api-key.js";
import { hashSecret, verifySecret } from "./password.js";
import { ApiKeyStore, type ApiKeyRow } from "./api-key-store.js";
import { UserStore, type UserRow } from "./user-store.js";
import { SessionStore } from "./session-store.js";

export interface AuthServiceOptions {
  apiKeyStore: ApiKeyStore;
  userStore: UserStore;
  sessionStore: SessionStore;
}

export type ApiKeyAuthResult =
  | { ok: true; key: ApiKeyRow }
  | { ok: false; reason: "invalid" | "disabled" | "expired" };

export class AuthService {
  private readonly apiKeyStore: ApiKeyStore;
  private readonly userStore: UserStore;
  private readonly sessionStore: SessionStore;

  constructor(options: AuthServiceOptions) {
    this.apiKeyStore = options.apiKeyStore;
    this.userStore = options.userStore;
    this.sessionStore = options.sessionStore;
  }

  createApiKey(input: {
    name: string;
    modelAllowlist?: string[];
    rpmLimit?: number;
    maxConcurrency?: number;
    monthlyBudgetUsd?: number;
    expiresAt?: string;
  }): { fullKey: string; row: ApiKeyRow } {
    const { fullKey, prefix } = generateApiKey();
    const keyHash = hashApiKey(fullKey);
    const row = this.apiKeyStore.createKey({
      name: input.name,
      keyHash,
      prefix,
      modelAllowlistJson: input.modelAllowlist ? JSON.stringify(input.modelAllowlist) : undefined,
      rpmLimit: input.rpmLimit,
      maxConcurrency: input.maxConcurrency,
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      expiresAt: input.expiresAt,
    });
    return { fullKey, row };
  }

  authenticateApiKey(rawKey: string): ApiKeyAuthResult {
    const rows = this.apiKeyStore.listKeys();
    for (const row of rows) {
      if (verifySecret(rawKey, row.key_hash)) {
        if (!row.enabled) return { ok: false, reason: "disabled" };
        if (row.expires_at) {
          const now = new Date().toISOString();
          if (row.expires_at <= now) return { ok: false, reason: "expired" };
        }
        return { ok: true, key: row };
      }
    }
    return { ok: false, reason: "invalid" };
  }

  listApiKeys(): ApiKeyRow[] {
    return this.apiKeyStore.listKeys();
  }

  disableApiKey(id: string): void {
    this.apiKeyStore.setEnabled(id, false);
  }

  enableApiKey(id: string): void {
    this.apiKeyStore.setEnabled(id, true);
  }

  deleteApiKey(id: string): void {
    this.apiKeyStore.deleteKey(id);
  }

  async createUser(username: string, password: string): Promise<UserRow> {
    if (!username || username.trim() === "") {
      throw new Error("Username must not be empty.");
    }
    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    const passwordHash = hashSecret(password);
    return this.userStore.createUser({ username: username.trim(), passwordHash });
  }

  async login(username: string, password: string): Promise<{ token: string; expiresAt: string } | undefined> {
    const user = this.userStore.getUserByUsername(username);
    if (!user) return undefined;

    const valid = verifySecret(password, user.password_hash);
    if (!valid) return undefined;

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    this.sessionStore.createSession({ token, userId: user.id, expiresAt });
    return { token, expiresAt };
  }

  async logout(token: string): Promise<void> {
    this.sessionStore.deleteSession(token);
  }

  async getUserBySession(token: string): Promise<UserRow | undefined> {
    const session = this.sessionStore.getSession(token);
    if (!session) return undefined;
    const now = new Date().toISOString();
    if (session.expires_at <= now) return undefined;
    return this.userStore.getUserById(session.user_id);
  }

  hasUsers(): boolean {
    return this.userStore.listUsers().length > 0;
  }

  setLastUsed(keyId: string): void {
    this.apiKeyStore.setLastUsed(keyId);
  }
}
