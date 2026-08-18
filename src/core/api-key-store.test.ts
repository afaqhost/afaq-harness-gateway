import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ApiKeyStore } from "./api-key-store.js";

describe("ApiKeyStore", () => {
  let store: ApiKeyStore;

  beforeEach(() => {
    store = new ApiKeyStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("creates and retrieves a key by id and hash", () => {
    const row = store.createKey({
      name: "test-key",
      keyHash: "hashed-value-123",
      prefix: "ahg_live_abcd1234",
      rpmLimit: 100,
      monthlyBudgetUsd: 50.0,
    });
    expect(row.id).toBeTruthy();
    expect(row.name).toBe("test-key");
    expect(row.enabled).toBe(1);
    expect(row.rpm_limit).toBe(100);
    expect(row.monthly_budget_usd).toBe(50.0);

    expect(store.getKeyById(row.id)?.name).toBe("test-key");
    expect(store.getKeyByHash("hashed-value-123")?.id).toBe(row.id);
  });

  it("lists keys", () => {
    store.createKey({ name: "a", keyHash: "h1", prefix: "p1" });
    store.createKey({ name: "b", keyHash: "h2", prefix: "p2" });
    expect(store.listKeys()).toHaveLength(2);
  });

  it("disables and enables a key", () => {
    const row = store.createKey({ name: "toggle", keyHash: "h3", prefix: "p3" });
    expect(store.getKeyById(row.id)?.enabled).toBe(1);

    store.setEnabled(row.id, false);
    expect(store.getKeyById(row.id)?.enabled).toBe(0);

    store.setEnabled(row.id, true);
    expect(store.getKeyById(row.id)?.enabled).toBe(1);
  });

  it("updates last_used_at", () => {
    const row = store.createKey({ name: "usage", keyHash: "h4", prefix: "p4" });
    expect(store.getKeyById(row.id)?.last_used_at).toBeNull();

    store.setLastUsed(row.id);
    expect(store.getKeyById(row.id)?.last_used_at).toBeTruthy();
  });

  it("deletes a key", () => {
    const row = store.createKey({ name: "del", keyHash: "h5", prefix: "p5" });
    store.deleteKey(row.id);
    expect(store.getKeyById(row.id)).toBeUndefined();
  });

  it("rejects duplicate key_hash", () => {
    store.createKey({ name: "first", keyHash: "same-hash", prefix: "p1" });
    expect(() =>
      store.createKey({ name: "second", keyHash: "same-hash", prefix: "p2" }),
    ).toThrow();
  });
});
