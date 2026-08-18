import { describe, it, expect } from "vitest";
import { UserStore } from "./user-store.js";

describe("UserStore", () => {
  it("creates and retrieves a user by id and username", () => {
    const store = new UserStore(":memory:");
    const row = store.createUser({ username: "alice", passwordHash: "hashed-pw" });
    expect(row.id).toBeTruthy();
    expect(row.username).toBe("alice");

    expect(store.getUserByUsername("alice")?.id).toBe(row.id);
    expect(store.getUserById(row.id)?.username).toBe("alice");
    store.close();
  });

  it("lists users", () => {
    const store = new UserStore(":memory:");
    store.createUser({ username: "a", passwordHash: "h1" });
    store.createUser({ username: "b", passwordHash: "h2" });
    expect(store.listUsers()).toHaveLength(2);
    store.close();
  });

  it("rejects duplicate username", () => {
    const store = new UserStore(":memory:");
    store.createUser({ username: "dup", passwordHash: "h" });
    expect(() => store.createUser({ username: "dup", passwordHash: "h2" })).toThrow();
    store.close();
  });

  it("returns undefined for missing user", () => {
    const store = new UserStore(":memory:");
    expect(store.getUserByUsername("nobody")).toBeUndefined();
    expect(store.getUserById("missing")).toBeUndefined();
    store.close();
  });
});
