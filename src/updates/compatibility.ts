import { compareVersions } from "../install/version.js";
import type { CompatibilityResult, VersionRange } from "./types.js";

export function checkCompatibility(
  version: string,
  range?: VersionRange,
): CompatibilityResult {
  const notes = range?.notes ?? [];

  if (!range) {
    return { version, status: "unknown", notes };
  }

  if (range.blocked && range.blocked.includes(version)) {
    return {
      version,
      status: "incompatible",
      reason: `Version ${version} is blocked/known-incompatible`,
      notes,
    };
  }

  if (range.allowed && range.allowed.length > 0 && !range.allowed.includes(version)) {
    return {
      version,
      status: "incompatible",
      reason: `Version ${version} is not in the allowed list`,
      notes,
    };
  }

  if (range.minimum && compareVersions(version, range.minimum) < 0) {
    return {
      version,
      status: "incompatible",
      reason: `Version ${version} is below minimum ${range.minimum}`,
      notes,
    };
  }

  if (range.maximum && compareVersions(version, range.maximum) > 0) {
    return {
      version,
      status: "incompatible",
      reason: `Version ${version} is above maximum ${range.maximum}`,
      notes,
    };
  }

  return { version, status: "supported", notes };
}
