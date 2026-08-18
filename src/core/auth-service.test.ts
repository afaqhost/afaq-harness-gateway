import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuthService } from "./auth-service.js";
import { ApiKeyStore } from "./api-key-store.js";
import { UserStore } from "./user-store.js";
import { SessionStore } from "./session-store.js";

describe("AuthService", () => {
  let tmpDir: string;
  let apiKeyStore: ApiKeyStore;
  let userStore: UserStore;
  let sessionStore: SessionStore;
  let auth: AuthService;

  function setup() {
    tmpDir = mkdtempSync(join(tmpdir(), "auth-test-"));
    const dbPath = join(tmpDir, "test.db");
    apiKeyStore = new ApiKeyStore(":memory:");
    userStore = new UserStore(dbPath);
    sessionStore = new SessionStore(dbPath);
    auth = new AuthService({ apiKeyStore, userStore, sessionStore });
  }

  afterEach(() => {
    apiKeyStore?.close();
    sessionStore?.close();
    userStore?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("API key lifecycle", () => {
    it("creates, authenticates, disables, enables, and deletes a key", () => {
      setup();
      const { fullKey, row } = auth.createApiKey({ name: "test-key" });

      // The full key should never be stored — only a hash and prefix
      expect(row.key_hash).not.toBe(fullKey);
      expect(row.key_hash).toMatch(/^scrypt\$/);
      expect(row.prefix).toMatch(/^ahg_live_/);
      expect(row.name).toBe("test-key");

      // Authenticate
      const result = auth.authenticateApiKey(fullKey);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.key.id).toBe(row.id);
      }

      // Disable
      auth.disableApiKey(row.id);
      const disabled = auth.authenticateApiKey(fullKey);
      expect(disabled.ok).toBe(false);
      if (!disabled.ok) expect(disabled.reason).toBe("disabled");

      // Re-enable
      auth.enableApiKey(row.id);
      const reenabled = auth.authenticateApiKey(fullKey);
      expect(reenabled.ok).toBe(true);

      // Delete
      auth.deleteApiKey(row.id);
      const deleted = auth.authenticateApiKey(fullKey);
      expect(deleted.ok).toBe(false);
      if (!deleted.ok) expect(deleted.reason).toBe("invalid");
    });

    it("rejects an expired key", () => {
      setup();
      const { fullKey } = auth.createApiKey({
        name: "expired-key",
        expiresAt: "2020-01-01T00:00:00.000Z",
      });

      const result = auth.authenticateApiKey(fullKey);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("expired");
    });

    it("rejects an unknown key", () => {
      setup();
      const result = auth.authenticateApiKey("ahg_live_nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid");
    });

    it("lists all keys", () => {
      setup();
      auth.createApiKey({ name: "a" });
      auth.createApiKey({ name: "b" });
      expect(auth.listApiKeys()).toHaveLength(2);
    });

    it("stores model allowlist as JSON", () => {
      setup();
      const { row } = auth.createApiKey({
        name: "restricted",
        modelAllowlist: ["fake-harness/model-a", "fake-harness/model-b"],
      });
      expect(JSON.parse(row.model_allowlist_json!)).toEqual(["fake-harness/model-a", "fake-harness/model-b"]);
    });
  });

  describe("User lifecycle", () => {
    it("creates a user and rejects empty username", async () => {
      setup();
      const user = await auth.createUser("alice", "securepassword");
      expect(user.username).toBe("alice");

      await expect(auth.createUser("", "password123")).rejects.toThrow("Username must not be empty.");
      await expect(auth.createUser("bob", "short")).rejects.toThrow("Password must be at least 8 characters.");
    });

    it("logs in, retrieves user by session, and logs out", async () => {
      setup();
      await auth.createUser("carol", "mypassword123");

      const loginResult = await auth.login("carol", "mypassword123");
      expect(loginResult).toBeDefined();
      expect(loginResult!.token).toBeTruthy();
      expect(loginResult!.expiresAt).toBeTruthy();

      const user = await auth.getUserBySession(loginResult!.token);
      expect(user?.username).toBe("carol");

      await auth.logout(loginResult!.token);
      const gone = await auth.getUserBySession(loginResult!.token);
      expect(gone).toBeUndefined();
    });

    it("returns undefined for wrong credentials", async () => {
      setup();
      await auth.createUser("dave", "correctpassword");

      expect(await auth.login("dave", "wrongpassword")).toBeUndefined();
      expect(await auth.login("nobody", "correctpassword")).toBeUndefined();
    });

    it("returns undefined for an expired session", async () => {
      setup();
      const user = await auth.createUser("eve", "password1234");

      // Create a session that's already expired
      const token = "expired-session-token";
      sessionStore.createSession({
        token,
        userId: user.id,
        expiresAt: "2020-01-01T00:00:00.000Z",
      });

      const result = await auth.getUserBySession(token);
      expect(result).toBeUndefined();
    });
  });
});
