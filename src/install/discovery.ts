import { accessSync, constants } from "node:fs";
import { join, delimiter } from "node:path";
import type { DiscoveryResult } from "./types.js";
import { resolveSafePath } from "./path-resolution.js";

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function discoverBinary(
  binaryName: string,
  candidateDirs?: string[],
): DiscoveryResult {
  if (typeof binaryName !== "string" || binaryName.trim().length === 0) {
    return { found: false, error: "Binary name must be a non-empty string" };
  }

  if (binaryName.includes("/") || binaryName.includes("\\")) {
    return { found: false, error: "Binary name must not contain path separators" };
  }

  const dirs: string[] = [];

  if (candidateDirs) {
    for (const dir of candidateDirs) {
      try {
        dirs.push(resolveSafePath(dir));
      } catch {
        // skip unsafe paths silently
      }
    }
  }

  const pathEnv = process.env.PATH ?? "";
  for (const segment of pathEnv.split(delimiter)) {
    if (segment.length > 0) {
      try {
        dirs.push(resolveSafePath(segment));
      } catch {
        // skip unsafe PATH entries
      }
    }
  }

  for (const dir of dirs) {
    const candidate = join(dir, binaryName);
    if (isExecutable(candidate)) {
      return { found: true, path: candidate };
    }
  }

  return { found: false };
}
