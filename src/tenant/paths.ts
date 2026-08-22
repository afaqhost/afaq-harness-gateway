import { isAbsolute, normalize, join } from "node:path";

export class PathContainmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathContainmentError";
  }
}

export function sanitizeRootDir(rootDir: string): string {
  if (typeof rootDir !== "string" || rootDir.trim().length === 0) {
    throw new PathContainmentError("Root directory must be a non-empty string");
  }

  const trimmed = rootDir.trim();

  if (trimmed.includes("\0")) {
    throw new PathContainmentError("Root directory contains null byte");
  }

  if (trimmed.includes("..")) {
    throw new PathContainmentError(`Root directory must not contain traversal: ${trimmed}`);
  }

  if (!isAbsolute(trimmed)) {
    throw new PathContainmentError(`Root directory must be absolute, got: ${trimmed}`);
  }

  let normalized = normalize(trimmed);
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export interface TenantPaths {
  root: string;
  data: string;
  database: string;
  config: string;
  credentials: string;
  logs: string;
  artifacts: string;
}

export function resolveTenantPaths(rootDir: string): TenantPaths {
  const root = sanitizeRootDir(rootDir);
  const data = join(root, "data");
  return {
    root,
    data,
    database: join(data, "tenant.db"),
    config: join(root, "config"),
    credentials: join(root, "credentials"),
    logs: join(root, "logs"),
    artifacts: join(root, "artifacts"),
  };
}

export function assertWithinTenant(rootDir: string, candidate: string): string {
  const root = sanitizeRootDir(rootDir);
  const normalized = sanitizeRootDir(candidate);

  if (normalized === root) {
    return normalized;
  }

  const prefix = root.endsWith("/") ? root : root + "/";
  if (!normalized.startsWith(prefix)) {
    throw new PathContainmentError(
      `Path "${normalized}" is not within tenant root "${root}"`,
    );
  }

  return normalized;
}
