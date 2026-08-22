import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectVersion,
  parseVersion,
  compareVersions,
  validateVersion,
} from "./version.js";

describe("parseVersion", () => {
  it("parses semver from a version string", () => {
    expect(parseVersion("1.2.3")).toBe("1.2.3");
  });

  it("parses version with prefix text", () => {
    expect(parseVersion("my-tool version 2.0.1")).toBe("2.0.1");
  });

  it("parses version with v prefix", () => {
    expect(parseVersion("v3.1.0")).toBe("3.1.0");
  });

  it("parses version with prerelease tag", () => {
    expect(parseVersion("1.0.0-beta.1")).toBe("1.0.0-beta.1");
  });

  it("returns undefined for non-version strings", () => {
    expect(parseVersion("no version here")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseVersion("")).toBeUndefined();
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("returns negative for older version", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("returns positive for newer version", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
  });

  it("compares patch versions", () => {
    expect(compareVersions("1.0.1", "1.0.2")).toBeLessThan(0);
  });

  it("compares minor versions", () => {
    expect(compareVersions("1.1.0", "1.2.0")).toBeLessThan(0);
  });

  it("handles prerelease ordering", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
  });
});

describe("validateVersion", () => {
  it("passes when no policy is defined", () => {
    const result = validateVersion("1.0.0");
    expect(result.supported).toBe(true);
  });

  it("passes when version meets minimum", () => {
    const result = validateVersion("2.0.0", { minimum: "1.0.0" });
    expect(result.supported).toBe(true);
  });

  it("fails when version is below minimum", () => {
    const result = validateVersion("0.5.0", { minimum: "1.0.0" });
    expect(result.supported).toBe(false);
    expect(result.reason).toContain("below minimum");
  });

  it("passes when version is in allowlist", () => {
    const result = validateVersion("1.0.0", {
      allowlist: ["1.0.0", "2.0.0"],
    });
    expect(result.supported).toBe(true);
  });

  it("fails when version is not in allowlist", () => {
    const result = validateVersion("3.0.0", {
      allowlist: ["1.0.0", "2.0.0"],
    });
    expect(result.supported).toBe(false);
    expect(result.reason).toContain("not in the allowed list");
  });

  it("checks both minimum and allowlist", () => {
    const result = validateVersion("0.5.0", {
      minimum: "1.0.0",
      allowlist: ["1.0.0", "2.0.0"],
    });
    expect(result.supported).toBe(false);
  });

  it("includes detected version and policy in result", () => {
    const policy = { minimum: "1.0.0" };
    const result = validateVersion("0.5.0", policy);
    expect(result.detectedVersion).toBe("0.5.0");
    expect(result.policy).toBe(policy);
  });
});

describe("detectVersion", () => {
  it("detects version from a real command", () => {
    const result = detectVersion(process.execPath, ["node", "--version"]);
    expect(result.detected).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("returns error for empty version command", () => {
    const result = detectVersion(process.execPath, []);
    expect(result.detected).toBe(false);
    expect(result.error).toContain("must not be empty");
  });

  it("returns error for nonexistent binary", () => {
    const result = detectVersion("/nonexistent/binary", [
      "/nonexistent/binary",
      "--version",
    ]);
    expect(result.detected).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("uses shell:false (no shell injection)", () => {
    const dir = mkdtempSync(join(tmpdir(), "version-shell-test-"));
    const binPath = join(dir, "my-echo");
    writeFileSync(binPath, '#!/bin/sh\necho "$1"\n');
    chmodSync(binPath, 0o755);
    try {
      // If shell:true were used, the semicolon would be interpreted as two commands
      const result = detectVersion(binPath, ["echo", "1.0.0; echo hacked"]);
      expect(result.detected).toBe(true);
      expect(result.version).toBe("1.0.0");
      // The raw output should contain the literal string, not two separate outputs
      expect(result.raw).toBe("1.0.0; echo hacked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the provided binary path, not the versionCommand executable name", () => {
    const dir = mkdtempSync(join(tmpdir(), "version-path-test-"));
    const binPath = join(dir, "my-version-tool");
    writeFileSync(binPath, "#!/bin/sh\necho 9.9.9\n");
    chmodSync(binPath, 0o755);
    try {
      const result = detectVersion(binPath, ["echo", "--version"]);
      expect(result.detected).toBe(true);
      expect(result.version).toBe("9.9.9");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
