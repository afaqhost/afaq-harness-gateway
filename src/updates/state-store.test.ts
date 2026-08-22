import { describe, it, expect, beforeEach } from "vitest";
import { VersionStateStore } from "./state-store.js";

describe("VersionStateStore", () => {
  let store: VersionStateStore;

  beforeEach(() => {
    store = new VersionStateStore(":memory:");
  });

  it("upserts and retrieves a version state", () => {
    const state = store.upsert({
      definitionId: "test-harness",
      installedVersion: "1.0.0",
      compatibilityStatus: "supported",
    });

    expect(state.definitionId).toBe("test-harness");
    expect(state.installedVersion).toBe("1.0.0");
    expect(state.compatibilityStatus).toBe("supported");
    expect(state.notes).toEqual([]);
    expect(state.checkedAt).toBeTruthy();

    const fetched = store.get("test-harness");
    expect(fetched).toEqual(state);
  });

  it("upserts with all optional fields", () => {
    const state = store.upsert({
      definitionId: "test-harness",
      installedVersion: "2.0.0",
      latestKnownVersion: "3.0.0",
      compatibilityStatus: "supported",
      knownGoodVersion: "2.0.0",
      notes: ["migrated from v1"],
    });

    expect(state.latestKnownVersion).toBe("3.0.0");
    expect(state.knownGoodVersion).toBe("2.0.0");
    expect(state.notes).toEqual(["migrated from v1"]);
  });

  it("updates existing row on upsert", () => {
    store.upsert({
      definitionId: "test-harness",
      installedVersion: "1.0.0",
      compatibilityStatus: "supported",
    });

    const updated = store.upsert({
      definitionId: "test-harness",
      installedVersion: "2.0.0",
      compatibilityStatus: "supported",
      knownGoodVersion: "2.0.0",
    });

    expect(updated.installedVersion).toBe("2.0.0");
    expect(updated.knownGoodVersion).toBe("2.0.0");

    const all = store.list();
    expect(all).toHaveLength(1);
  });

  it("returns undefined for nonexistent definition", () => {
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("lists all states ordered by definitionId", () => {
    store.upsert({
      definitionId: "b-harness",
      installedVersion: "1.0.0",
      compatibilityStatus: "supported",
    });
    store.upsert({
      definitionId: "a-harness",
      installedVersion: "2.0.0",
      compatibilityStatus: "incompatible",
    });

    const all = store.list();
    expect(all).toHaveLength(2);
    expect(all[0].definitionId).toBe("a-harness");
    expect(all[1].definitionId).toBe("b-harness");
  });

  it("closes without error", () => {
    store.upsert({
      definitionId: "test",
      installedVersion: "1.0.0",
      compatibilityStatus: "supported",
    });
    expect(() => store.close()).not.toThrow();
  });
});
