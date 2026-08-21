import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import type { InstallDefinition, InstallRecord, HealthResult } from "./types.js";
import { resolveSafePath } from "./path-resolution.js";

const HEALTH_TIMEOUT_MS = 10_000;

export function checkHealth(
  record: InstallRecord,
  definition: InstallDefinition,
): HealthResult {
  let executable: string;
  try {
    executable = resolveSafePath(record.path);
  } catch (err) {
    return {
      ok: false,
      message: `Invalid binary path: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    accessSync(executable, constants.X_OK);
  } catch {
    return {
      ok: false,
      message: `Binary not accessible or not executable: ${record.path}`,
    };
  }

  if (definition.versionCommand.length === 0) {
    return { ok: true };
  }

  const args = definition.versionCommand.slice(1);

  const result = spawnSync(executable, args, {
    shell: false,
    timeout: HEALTH_TIMEOUT_MS,
    encoding: "utf-8",
    env: { ...process.env },
  });

  if (result.error) {
    return {
      ok: false,
      message: `Health check execution failed: ${result.error.message}`,
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      message: `Health check exited with code ${result.status}`,
    };
  }

  return { ok: true };
}
