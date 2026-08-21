import { describe, it, expect, beforeEach } from "vitest";
import { InstallStore } from "./store.js";

describe("InstallStore", () => {
  let store: InstallStore;

  beforeEach(() => {
    store = new InstallStore(":memory:");
  });

  it("creates and retrieves a record", () => {
    const record = store.createRecord({
      id: "inst-1",
      definitionId: "def-1",
      path: "/usr/bin/test",
      version: "1.0.0",
      strategy: "copy",
    });

    expect(record.id).toBe("inst-1");
    expect(record.definitionId).toBe("def-1");
    expect(record.path).toBe("/usr/bin/test");
    expect(record.version).toBe("1.0.0");
    expect(record.strategy).toBe("copy");
    expect(record.state).toBe("pending");
    expect(record.createdAt).toBeTruthy();
    expect(record.updatedAt).toBeTruthy();

    const fetched = store.getRecord("inst-1");
    expect(fetched).toEqual(record);
  });

  it("creates record with explicit state and checksum", () => {
    const record = store.createRecord({
      id: "inst-2",
      definitionId: "def-1",
      path: "/usr/bin/test",
      version: "2.0.0",
      strategy: "copy",
      state: "verified",
      checksum: "abc123",
    });

    expect(record.state).toBe("verified");
    expect(record.checksum).toBe("abc123");
  });

  it("lists all records ordered by creation time", () => {
    store.createRecord({
      id: "inst-a",
      definitionId: "def-1",
      path: "/a",
      version: "1.0.0",
      strategy: "copy",
    });
    store.createRecord({
      id: "inst-b",
      definitionId: "def-2",
      path: "/b",
      version: "2.0.0",
      strategy: "copy",
    });

    const records = store.listRecords();
    expect(records).toHaveLength(2);
    expect(records[0].id).toBe("inst-a");
    expect(records[1].id).toBe("inst-b");
  });

  it("lists records by definition", () => {
    store.createRecord({
      id: "inst-1",
      definitionId: "def-1",
      path: "/a",
      version: "1.0.0",
      strategy: "copy",
    });
    store.createRecord({
      id: "inst-2",
      definitionId: "def-2",
      path: "/b",
      version: "2.0.0",
      strategy: "copy",
    });
    store.createRecord({
      id: "inst-3",
      definitionId: "def-1",
      path: "/c",
      version: "1.1.0",
      strategy: "copy",
    });

    const records = store.listByDefinition("def-1");
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.definitionId === "def-1")).toBe(true);
  });

  it("updates record state", () => {
    store.createRecord({
      id: "inst-1",
      definitionId: "def-1",
      path: "/a",
      version: "1.0.0",
      strategy: "copy",
    });

    const updated = store.updateState("inst-1", "verified");
    expect(updated?.state).toBe("verified");
    expect(updated?.updatedAt).toBeTruthy();
  });

  it("updates record version", () => {
    store.createRecord({
      id: "inst-1",
      definitionId: "def-1",
      path: "/a",
      version: "1.0.0",
      strategy: "copy",
    });

    const updated = store.updateVersion("inst-1", "1.1.0");
    expect(updated?.version).toBe("1.1.0");
  });

  it("removes a record", () => {
    store.createRecord({
      id: "inst-1",
      definitionId: "def-1",
      path: "/a",
      version: "1.0.0",
      strategy: "copy",
    });

    expect(store.removeRecord("inst-1")).toBe(true);
    expect(store.getRecord("inst-1")).toBeUndefined();
  });

  it("returns false when removing nonexistent record", () => {
    expect(store.removeRecord("nonexistent")).toBe(false);
  });

  it("returns undefined for nonexistent record", () => {
    expect(store.getRecord("nonexistent")).toBeUndefined();
  });

  it("supports multiple independent installations of different definitions", () => {
    store.createRecord({
      id: "cmd-1",
      definitionId: "command-code",
      path: "/usr/bin/cmd",
      version: "1.0.0",
      strategy: "copy",
    });
    store.createRecord({
      id: "claude-1",
      definitionId: "claude-code",
      path: "/usr/bin/claude",
      version: "2.0.0",
      strategy: "copy",
    });
    store.createRecord({
      id: "codex-1",
      definitionId: "codex",
      path: "/usr/bin/codex",
      version: "0.5.0",
      strategy: "copy",
    });

    expect(store.listRecords()).toHaveLength(3);
    expect(store.listByDefinition("command-code")).toHaveLength(1);
    expect(store.listByDefinition("claude-code")).toHaveLength(1);
    expect(store.listByDefinition("codex")).toHaveLength(1);
  });
});
