import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkHealth } from "./health.js";
import type { InstallDefinition, InstallRecord } from "./types.js";

function makeRecord(overrides?: Partial<InstallRecord>): InstallRecord {
  return {
    id: "rec-1",
    definitionId: "def-1",
    path: "/usr/bin/node",
    version: "1.0.0",
    strategy: "copy",
    state: "verified",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDefinition(overrides?: Partial<InstallDefinition>): InstallDefinition {
  return {
    id: "def-1",
    name: "Test",
    binaryName: "node",
    versionCommand: ["node", "--version"],
    ...overrides,
  };
}

describe("checkHealth", () => {
  it("returns ok for a healthy installation", () => {
    const record = makeRecord({ path: "/usr/bin/node" });
    const definition = makeDefinition({
      versionCommand: ["node", "--version"],
    });

    const result = checkHealth(record, definition);
    expect(result.ok).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("returns not-ok for nonexistent binary", () => {
    const record = makeRecord({ path: "/nonexistent/binary" });
    const definition = makeDefinition({
      versionCommand: ["/nonexistent/binary", "--version"],
    });

    const result = checkHealth(record, definition);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not accessible");
  });

  it("returns ok when version command is empty (no check needed)", () => {
    const record = makeRecord({ path: "/usr/bin/node" });
    const definition = makeDefinition({ versionCommand: [] });

    const result = checkHealth(record, definition);
    expect(result.ok).toBe(true);
  });

  it("returns not-ok when version command fails", () => {
    const record = makeRecord({ path: "/usr/bin/node" });
    const definition = makeDefinition({
      versionCommand: ["node", "-e", "process.exit(1)"],
    });

    const result = checkHealth(record, definition);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("exited with code");
  });

  it("runs the installed binary path, not the versionCommand executable name", () => {
    const dir = mkdtempSync(join(tmpdir(), "health-path-test-"));
    const binPath = join(dir, "custom-health-bin");
    writeFileSync(binPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binPath, 0o755);
    try {
      const record = makeRecord({ path: binPath });
      const definition = makeDefinition({
        versionCommand: ["definitely-not-a-real-binary", "--version"],
      });
      const result = checkHealth(record, definition);
      expect(result.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
