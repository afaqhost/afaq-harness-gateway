import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InstallService } from "./install-service.js";
import { InstallStore } from "./store.js";
import type { InstallDefinition } from "./types.js";

describe("InstallService", () => {
  let service: InstallService;
  let store: InstallStore;
  let tempDir: string;

  beforeEach(() => {
    store = new InstallStore(":memory:");
    service = new InstallService(store);
    tempDir = mkdtempSync(join(tmpdir(), "install-service-test-"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createBinary(name: string, content: string): string {
    const path = join(tempDir, name);
    writeFileSync(path, content);
    chmodSync(path, 0o755);
    return path;
  }

  const nodeDefinition: InstallDefinition = {
    id: "node",
    name: "Node.js",
    binaryName: "node",
    versionCommand: ["node", "--version"],
    versionPolicy: { minimum: "18.0.0" },
  };

  describe("registerDefinition", () => {
    it("registers and retrieves a definition", () => {
      service.registerDefinition(nodeDefinition);
      expect(service.getDefinition("node")).toEqual(nodeDefinition);
    });

    it("throws on duplicate registration", () => {
      service.registerDefinition(nodeDefinition);
      expect(() => service.registerDefinition(nodeDefinition)).toThrow(
        'already registered',
      );
    });

    it("lists all definitions", () => {
      service.registerDefinition(nodeDefinition);
      service.registerDefinition({
        id: "other",
        name: "Other",
        binaryName: "other",
        versionCommand: ["other", "-v"],
      });
      expect(service.listDefinitions()).toHaveLength(2);
    });
  });

  describe("discover", () => {
    it("discovers a binary in candidate dirs", () => {
      service.registerDefinition(nodeDefinition);
      const result = service.discover("node", ["/usr/bin"]);
      expect(result.found).toBe(true);
    });

    it("returns error for unknown definition", () => {
      const result = service.discover("unknown");
      expect(result.found).toBe(false);
      expect(result.error).toContain("Unknown definition");
    });
  });

  describe("detectVersion", () => {
    it("detects version for a known binary", () => {
      service.registerDefinition(nodeDefinition);
      const result = service.detectVersion("node", "/usr/bin/node");
      expect(result.detected).toBe(true);
      expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("returns error for unknown definition", () => {
      const result = service.detectVersion("unknown", "/usr/bin/node");
      expect(result.detected).toBe(false);
      expect(result.error).toContain("Unknown definition");
    });
  });

  describe("validateVersion", () => {
    it("validates a supported version", () => {
      service.registerDefinition(nodeDefinition);
      const result = service.validateVersion("node", "20.0.0");
      expect(result.supported).toBe(true);
    });

    it("rejects an unsupported version", () => {
      service.registerDefinition(nodeDefinition);
      const result = service.validateVersion("node", "10.0.0");
      expect(result.supported).toBe(false);
      expect(result.reason).toContain("below minimum");
    });
  });

  describe("install", () => {
    it("installs a binary using copy strategy", () => {
      const sourcePath = createBinary("node-copy", "#!/bin/sh\necho v20.0.0");
      service.registerDefinition({
        ...nodeDefinition,
        binaryName: "node-copy",
        versionCommand: ["echo", "v20.0.0"],
      });

      const installDir = join(tempDir, "installed");
      const result = service.install({
        definitionId: "node",
        strategy: "copy",
        sourcePath,
        installDir,
      });

      expect(result.success).toBe(true);
      expect(result.record).toBeDefined();
      expect(result.record!.state).toBe("verified");
      expect(result.record!.version).toBe("20.0.0");
    });

    it("fails for unknown definition", () => {
      const result = service.install({
        definitionId: "unknown",
        strategy: "copy",
        sourcePath: "/usr/bin/node",
        installDir: join(tempDir, "install"),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown definition");
    });

    it("fails for unknown strategy", () => {
      service.registerDefinition(nodeDefinition);
      const result = service.install({
        definitionId: "node",
        strategy: "download" as unknown as "copy",
        sourcePath: "/usr/bin/node",
        installDir: join(tempDir, "install"),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown strategy");
    });

    it("fails when post-install version is below minimum", () => {
      const sourcePath = createBinary(
        "old-node",
        "#!/bin/sh\necho v10.0.0",
      );
      service.registerDefinition({
        ...nodeDefinition,
        binaryName: "old-node",
        versionCommand: ["echo", "v10.0.0"],
      });

      const result = service.install({
        definitionId: "node",
        strategy: "copy",
        sourcePath,
        installDir: join(tempDir, "installed"),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Post-install version check failed");
    });

    it("persists the record in the store", () => {
      const sourcePath = createBinary("node-copy", "#!/bin/sh\necho v20.0.0");
      service.registerDefinition({
        ...nodeDefinition,
        binaryName: "node-copy",
        versionCommand: ["echo", "v20.0.0"],
      });

      service.install({
        definitionId: "node",
        strategy: "copy",
        sourcePath,
        installDir: join(tempDir, "installed"),
      });

      const records = service.listRecords();
      expect(records).toHaveLength(1);
      expect(records[0].definitionId).toBe("node");
    });
  });

  describe("health", () => {
    it("returns ok for a verified installation", () => {
      const sourcePath = createBinary("node-copy", "#!/bin/sh\necho v20.0.0");
      service.registerDefinition({
        ...nodeDefinition,
        binaryName: "node-copy",
        versionCommand: ["echo", "v20.0.0"],
      });

      const result = service.install({
        definitionId: "node",
        strategy: "copy",
        sourcePath,
        installDir: join(tempDir, "installed"),
      });

      const health = service.health(result.record!.id);
      expect(health.ok).toBe(true);
    });

    it("returns not-ok for nonexistent record", () => {
      const health = service.health("nonexistent");
      expect(health.ok).toBe(false);
      expect(health.message).toContain("not found");
    });
  });

  describe("multiple harnesses", () => {
    it("supports independent installations of different definitions", () => {
      const bin1 = createBinary("harness-a", "#!/bin/sh\necho 1.0.0");
      const bin2 = createBinary("harness-b", "#!/bin/sh\necho 2.0.0");

      service.registerDefinition({
        id: "harness-a",
        name: "Harness A",
        binaryName: "harness-a",
        versionCommand: ["echo", "1.0.0"],
      });
      service.registerDefinition({
        id: "harness-b",
        name: "Harness B",
        binaryName: "harness-b",
        versionCommand: ["echo", "2.0.0"],
      });

      const result1 = service.install({
        definitionId: "harness-a",
        strategy: "copy",
        sourcePath: bin1,
        installDir: join(tempDir, "install-a"),
      });
      const result2 = service.install({
        definitionId: "harness-b",
        strategy: "copy",
        sourcePath: bin2,
        installDir: join(tempDir, "install-b"),
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(service.listRecords()).toHaveLength(2);
      expect(service.listByDefinition("harness-a")).toHaveLength(1);
      expect(service.listByDefinition("harness-b")).toHaveLength(1);
    });
  });

  describe("removeRecord", () => {
    it("marks a record as removed", () => {
      const sourcePath = createBinary("node-copy", "#!/bin/sh\necho v20.0.0");
      service.registerDefinition({
        ...nodeDefinition,
        binaryName: "node-copy",
        versionCommand: ["echo", "v20.0.0"],
      });

      const result = service.install({
        definitionId: "node",
        strategy: "copy",
        sourcePath,
        installDir: join(tempDir, "installed"),
      });

      expect(service.removeRecord(result.record!.id)).toBe(true);
      const record = service.getRecord(result.record!.id);
      expect(record?.state).toBe("removed");
    });

    it("returns false for nonexistent record", () => {
      expect(service.removeRecord("nonexistent")).toBe(false);
    });
  });
});
