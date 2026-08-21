import { spawnSync } from "node:child_process";
import type { VersionDetectionResult, VersionValidationResult, VersionPolicy } from "./types.js";
import { resolveSafePath } from "./path-resolution.js";

const VERSION_TIMEOUT_MS = 10_000;

export function detectVersion(
  binaryPath: string,
  versionCommand: readonly string[],
): VersionDetectionResult {
  if (versionCommand.length === 0) {
    return { detected: false, error: "Version command must not be empty" };
  }

  let executable: string;
  try {
    executable = resolveSafePath(binaryPath);
  } catch (err) {
    return {
      detected: false,
      error: `Invalid binary path: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const args = versionCommand.slice(1);

  const result = spawnSync(executable, args, {
    shell: false,
    timeout: VERSION_TIMEOUT_MS,
    encoding: "utf-8",
    env: { ...process.env },
  });

  if (result.error) {
    return { detected: false, error: result.error.message };
  }

  if (result.status !== 0 && !result.stdout) {
    return {
      detected: false,
      error: `Version command exited with code ${result.status}`,
    };
  }

  const raw = (result.stdout ?? result.stderr ?? "").trim();
  if (raw.length === 0) {
    return { detected: false, error: "Version command produced no output" };
  }

  const version = parseVersion(raw);
  if (!version) {
    return { detected: false, raw, error: "Could not parse version from output" };
  }

  return { detected: true, version, raw };
}

export function parseVersion(raw: string): string | undefined {
  const match = raw.match(/(\d+\.\d+\.\d+(?:[.-][\w.]+)?)/);
  return match?.[1];
}

export function compareVersions(a: string, b: string): number {
  const parsedA = parseSemverParts(a);
  const parsedB = parseSemverParts(b);

  if (parsedA.major !== parsedB.major) return parsedA.major - parsedB.major;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor - parsedB.minor;
  if (parsedA.patch !== parsedB.patch) return parsedA.patch - parsedB.patch;

  if (parsedA.prerelease === undefined && parsedB.prerelease === undefined) return 0;
  if (parsedA.prerelease === undefined) return 1;
  if (parsedB.prerelease === undefined) return -1;

  return parsedA.prerelease < parsedB.prerelease ? -1 : parsedA.prerelease > parsedB.prerelease ? 1 : 0;
}

function parseSemverParts(v: string): { major: number; minor: number; patch: number; prerelease?: string } {
  const dashIdx = v.indexOf("-");
  const core = dashIdx >= 0 ? v.slice(0, dashIdx) : v;
  const prerelease = dashIdx >= 0 ? v.slice(dashIdx + 1) : undefined;
  const parts = core.split(".");
  return {
    major: parseInt(parts[0] ?? "0", 10) || 0,
    minor: parseInt(parts[1] ?? "0", 10) || 0,
    patch: parseInt(parts[2] ?? "0", 10) || 0,
    prerelease,
  };
}

export function validateVersion(
  detectedVersion: string,
  policy?: VersionPolicy,
): VersionValidationResult {
  if (!policy) {
    return { supported: true, detectedVersion };
  }

  if (policy.allowlist && policy.allowlist.length > 0) {
    if (!policy.allowlist.includes(detectedVersion)) {
      return {
        supported: false,
        detectedVersion,
        policy,
        reason: `Version ${detectedVersion} is not in the allowed list [${policy.allowlist.join(", ")}]`,
      };
    }
  }

  if (policy.minimum) {
    if (compareVersions(detectedVersion, policy.minimum) < 0) {
      return {
        supported: false,
        detectedVersion,
        policy,
        reason: `Version ${detectedVersion} is below minimum ${policy.minimum}`,
      };
    }
  }

  return { supported: true, detectedVersion };
}
