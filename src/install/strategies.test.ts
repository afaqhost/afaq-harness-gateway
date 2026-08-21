import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { CopyBinaryStrategy, sha256File } from "./strategies.js";
import type { InstallDefinition } from "./types.js";

function makeDefinition(overrides?: Partial<InstallDefinition>): InstallDefinition {
  return {
    id: "test-harness",
    name: "Test Harness",
    binaryName: "test-bin",
    versionCommand: ["echo", "1.0.0"],
    ...overrides,
  };
}

describe("CopyBinaryStrategy", () => {
  let tempDir: string;
  let sourceDir: string;
  let installDir: string;
  let strategy: CopyBinaryStrategy;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "strategy-test-"));
    sourceDir = join(tempDir, "source");
    installDir = join(tempDir, "install");
    strategy = new CopyBinaryStrategy();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createSourceBinary(name: string, content: string): string {
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(sourceDir, { recursive: true });
    const path = join(sourceDir, name);
    writeFileSync(path, content);
    chmodSync(path, 0o755);
    return path;
  }

  it("copies a binary to the install directory", () => {
    const sourcePath = createSourceBinary("test-bin", "#!/bin/sh\necho 1.0.0");
    const def = makeDefinition();

    const result = strategy.execute({
      definition: def,
      sourcePath,
      installDir,
    });

    expect(result.success).toBe(true);
    expect(result.record).toBeDefined();
    expect(result.record!.path).toBe(join(installDir, "test-bin"));
    expect(existsSync(join(installDir, "test-bin"))).toBe(true);
  });

  it("sets executable permissions on copied binary", () => {
    const sourcePath = createSourceBinary("test-bin", "#!/bin/sh\necho 1.0.0");
    const def = makeDefinition();

    strategy.execute({ definition: def, sourcePath, installDir });

    const destPath = join(installDir, "test-bin");
    const stat = require("node:fs").statSync(destPath);
    expect(stat.mode & 0o111).toBeTruthy();
  });

  it("fails when source path is not provided", () => {
    const def = makeDefinition();
    const result = strategy.execute({
      definition: def,
      sourcePath: undefined,
      installDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Source path is required");
  });

  it("fails when source file does not exist", () => {
    const def = makeDefinition();
    const result = strategy.execute({
      definition: def,
      sourcePath: "/nonexistent/path",
      installDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("fails when source is not a file", () => {
    const def = makeDefinition();
    const result = strategy.execute({
      definition: def,
      sourcePath: tempDir,
      installDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not a file");
  });

  it("fails on checksum mismatch", () => {
    const sourcePath = createSourceBinary("test-bin", "#!/bin/sh\necho 1.0.0");
    const def = makeDefinition({ checksum: "deadbeef" });

    const result = strategy.execute({
      definition: def,
      sourcePath,
      installDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Checksum mismatch");
  });

  it("passes checksum verification when correct", () => {
    const content = "#!/bin/sh\necho 1.0.0";
    const sourcePath = createSourceBinary("test-bin", content);
    const expectedChecksum = createHash("sha256").update(content).digest("hex");
    const def = makeDefinition({ checksum: expectedChecksum });

    const result = strategy.execute({
      definition: def,
      sourcePath,
      installDir,
    });

    expect(result.success).toBe(true);
  });

  it("rejects unsafe source paths", () => {
    const def = makeDefinition();
    const result = strategy.execute({
      definition: def,
      sourcePath: "../evil/binary",
      installDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Path validation failed");
  });

  it("rejects unsafe install dir paths", () => {
    const sourcePath = createSourceBinary("test-bin", "#!/bin/sh\necho 1.0.0");
    const def = makeDefinition();

    const result = strategy.execute({
      definition: def,
      sourcePath,
      installDir: "../evil/install",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Path validation failed");
  });

  it("creates install directory if it does not exist", () => {
    const sourcePath = createSourceBinary("test-bin", "#!/bin/sh\necho 1.0.0");
    const nestedDir = join(installDir, "nested", "deep");
    const def = makeDefinition();

    const result = strategy.execute({
      definition: def,
      sourcePath,
      installDir: nestedDir,
    });

    expect(result.success).toBe(true);
    expect(existsSync(join(nestedDir, "test-bin"))).toBe(true);
  });
});

describe("sha256File", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sha256-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("computes correct SHA-256 hash", () => {
    const filePath = join(tempDir, "test-file");
    const content = "hello world";
    writeFileSync(filePath, content);

    const expected = createHash("sha256").update(content).digest("hex");
    expect(sha256File(filePath)).toBe(expected);
  });
});
