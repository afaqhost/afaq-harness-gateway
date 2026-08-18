import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "./session-store.js";
import { UserStore } from "./user-store.js";

describe("SessionStore", () => {
  let tmpDir: string;
  let userStore: UserStore;
  let sessionStore: SessionStore;

  function setup() {
    tmpDir = mkdtempSync(join(tmpdir(), "session-test-"));
    const dbPath = join(tmpDir, "test.db");
    userStore = new UserStore(dbPath);
    sessionStore = new SessionStore(dbPath);
    userStore.createUser({ username: "testuser", passwordHash: "hash" });
  }

  afterEach(() => {
    sessionStore?.close();
    userStore?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates and retrieves a session", () => {
    setup();
    const user = userStore.getUserByUsername("testuser")!;
    const row = sessionStore.createSession({
      token: "tok-abc",
      userId: user.id,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(row.token).toBe("tok-abc");
    expect(row.user_id).toBe(user.id);

    const found = sessionStore.getSession("tok-abc");
    expect(found?.token).toBe("tok-abc");
    expect(found?.user_id).toBe(user.id);
  });

  it("returns undefined for missing session", () => {
    setup();
    expect(sessionStore.getSession("nope")).toBeUndefined();
  });

  it("deletes a session by token", () => {
    setup();
    const user = userStore.getUserByUsername("testuser")!;
    sessionStore.createSession({ token: "t1", userId: user.id, expiresAt: "2099-01-01T00:00:00.000Z" });
    sessionStore.deleteSession("t1");
    expect(sessionStore.getSession("t1")).toBeUndefined();
  });

  it("deletes expired sessions", () => {
    setup();
    const user = userStore.getUserByUsername("testuser")!;
    sessionStore.createSession({ token: "expired", userId: user.id, expiresAt: "2020-01-01T00:00:00.000Z" });
    sessionStore.createSession({ token: "valid", userId: user.id, expiresAt: "2099-01-01T00:00:00.000Z" });

    sessionStore.deleteExpired("2025-01-01T00:00:00.000Z");
    expect(sessionStore.getSession("expired")).toBeUndefined();
    expect(sessionStore.getSession("valid")).toBeDefined();
  });
});
