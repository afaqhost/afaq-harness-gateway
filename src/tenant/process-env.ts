import { buildMinimalEnv } from "../harness/env.js";
import { resolveTenantPaths } from "./paths.js";
import type { Tenant } from "./types.js";

export const HOST_SENSITIVE_ENV_KEYS: ReadonlySet<string> = new Set([
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
  "DOCKER_CONTEXT",
  "KUBECONFIG",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "OPENAUTH_TOKEN",
  "NODE_OPTIONS",
  "NPM_TOKEN",
  "GITHUB_TOKEN",
  "GIT_CREDENTIALS",
]);

const AHG_PREFIX = "AHG_";

function isHostSensitive(key: string): boolean {
  return HOST_SENSITIVE_ENV_KEYS.has(key) || key.startsWith(AHG_PREFIX);
}

export class HostEnvLeakError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostEnvLeakError";
  }
}

export function buildTenantEnv(tenant: Tenant, extra?: Record<string, string>): Record<string, string> {
  const env = buildMinimalEnv();

  for (const key of Object.keys(env)) {
    if (isHostSensitive(key)) {
      delete env[key];
    }
  }

  const paths = resolveTenantPaths(tenant.rootDir);
  env.HOME = tenant.rootDir;
  env.TMPDIR = paths.artifacts;

  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      if (val !== undefined) env[key] = val;
    }
  }

  return env;
}

export function assertNoHostSensitiveEnv(env: Record<string, string>): void {
  for (const key of Object.keys(env)) {
    if (isHostSensitive(key)) {
      throw new HostEnvLeakError(`Host-sensitive env var "${key}" must not be present in tenant environment.`);
    }
  }
}
