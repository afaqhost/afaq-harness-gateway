import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverBinary } from "./discovery.js";

describe("discoverBinary", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "discovery-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds an executable binary in candidate dirs", () => {
    const binPath = join(tempDir, "test-binary");
    writeFileSync(binPath, "#!/bin/sh\necho hello");
    chmodSync(binPath, 0o755);

    const result = discoverBinary("test-binary", [tempDir]);
    expect(result.found).toBe(true);
    expect(result.path).toBe(binPath);
  });

  it("returns not-found for missing binary", () => {
    const result = discoverBinary("nonexistent-binary-xyz", [tempDir]);
    expect(result.found).toBe(false);
    expect(result.path).toBeUndefined();
  });

  it("skips non-executable files", () => {
    const binPath = join(tempDir, "not-executable");
    writeFileSync(binPath, "content");
    chmodSync(binPath, 0o644);

    const result = discoverBinary("not-executable", [tempDir]);
    expect(result.found).toBe(false);
  });

  it("rejects empty binary name", () => {
    const result = discoverBinary("", [tempDir]);
    expect(result.found).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects binary name with path separators", () => {
    const result = discoverBinary("../evil", [tempDir]);
    expect(result.found).toBe(false);
    expect(result.error).toContain("path separators");
  });

  it("skips unsafe candidate directories", () => {
    const result = discoverBinary("test-binary", ["relative/path"]);
    expect(result.found).toBe(false);
  });

  it("searches PATH environment as fallback", () => {
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = tempDir;
      const binPath = join(tempDir, "path-binary");
      writeFileSync(binPath, "#!/bin/sh\necho ok");
      chmodSync(binPath, 0o755);

      const result = discoverBinary("path-binary");
      expect(result.found).toBe(true);
      expect(result.path).toBe(binPath);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("candidate dirs take priority over PATH", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "discovery-test2-"));
    try {
      const bin1 = join(tempDir, "priority-bin");
      const bin2 = join(dir2, "priority-bin");
      writeFileSync(bin1, "#!/bin/sh\necho 1");
      chmodSync(bin1, 0o755);
      writeFileSync(bin2, "#!/bin/sh\necho 2");
      chmodSync(bin2, 0o755);

      const result = discoverBinary("priority-bin", [tempDir, dir2]);
      expect(result.found).toBe(true);
      expect(result.path).toBe(bin1);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
