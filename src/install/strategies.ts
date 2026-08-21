import { copyFileSync, mkdirSync, chmodSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveSafePath } from "./path-resolution.js";
import type { InstallDefinition, InstallResult, InstallStrategy } from "./types.js";

export class CopyBinaryStrategy implements InstallStrategy {
  readonly name = "copy" as const;

  execute(input: {
    definition: InstallDefinition;
    sourcePath?: string;
    installDir: string;
  }): InstallResult {
    const { definition, sourcePath, installDir } = input;

    if (!sourcePath) {
      return { success: false, error: "Source path is required for copy strategy" };
    }

    let safeSource: string;
    let safeInstallDir: string;
    try {
      safeSource = resolveSafePath(sourcePath);
      safeInstallDir = resolveSafePath(installDir);
    } catch (err) {
      return {
        success: false,
        error: `Path validation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!existsSync(safeSource)) {
      return { success: false, error: `Source binary not found: ${safeSource}` };
    }

    const sourceStat = statSync(safeSource);
    if (!sourceStat.isFile()) {
      return { success: false, error: `Source is not a file: ${safeSource}` };
    }

    if (definition.checksum) {
      const actual = sha256File(safeSource);
      if (actual !== definition.checksum) {
        return {
          success: false,
          error: `Checksum mismatch: expected ${definition.checksum}, got ${actual}`,
        };
      }
    }

    try {
      mkdirSync(safeInstallDir, { recursive: true });
    } catch (err) {
      return {
        success: false,
        error: `Failed to create install directory: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const destPath = join(safeInstallDir, definition.binaryName);

    try {
      copyFileSync(safeSource, destPath);
      chmodSync(destPath, 0o755);
    } catch (err) {
      return {
        success: false,
        error: `Failed to copy binary: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    return {
      success: true,
      record: {
        id: `${definition.id}-${Date.now()}`,
        definitionId: definition.id,
        path: destPath,
        version: "",
        strategy: this.name,
        state: "installed",
        checksum: definition.checksum,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  }
}

export function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}
