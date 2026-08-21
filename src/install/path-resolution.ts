import { isAbsolute, normalize } from "node:path";

export class PathResolutionError extends Error {}

export function resolveSafePath(candidate: string): string {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    throw new PathResolutionError("Path must be a non-empty string");
  }

  const trimmed = candidate.trim();

  if (trimmed.includes("\0")) {
    throw new PathResolutionError("Path contains null byte");
  }

  if (trimmed.includes("..")) {
    throw new PathResolutionError(`Path must not contain traversal: ${trimmed}`);
  }

  if (!isAbsolute(trimmed)) {
    throw new PathResolutionError(`Path must be absolute, got: ${trimmed}`);
  }

  let normalized = normalize(trimmed);
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function isSafePath(candidate: string): boolean {
  try {
    resolveSafePath(candidate);
    return true;
  } catch {
    return false;
  }
}
