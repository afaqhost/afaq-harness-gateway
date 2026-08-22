import { compareVersions } from "../install/version.js";
import { detectVersion } from "../install/version.js";
import type { HarnessAdapter } from "../harness/types.js";
import { checkCompatibility } from "./compatibility.js";
import { runAdapterContractTest } from "./contract-runner.js";
import type { VersionStateStore } from "./state-store.js";
import type {
  CompatibilityResult,
  UpdateStatus,
  UpdateValidationResult,
  VersionRange,
  VersionState,
} from "./types.js";

export interface UpdateServiceOptions {
  store: VersionStateStore;
  installOrUpdate(input: {
    definitionId: string;
    targetVersion: string;
    sourcePath?: string;
    installDir?: string;
  }): { success: boolean; path?: string; error?: string };
  getVersionCommand(definitionId: string): readonly string[] | undefined;
  getCompatibilityRange?(definitionId: string): VersionRange | undefined;
  getLatestKnownVersion?(definitionId: string): string | undefined;
  getAdapter?(definitionId: string): HarnessAdapter | undefined;
}

export class UpdateService {
  private readonly store: VersionStateStore;
  private readonly opts: UpdateServiceOptions;

  constructor(options: UpdateServiceOptions) {
    this.store = options.store;
    this.opts = options;
  }

  getState(definitionId: string): VersionState | undefined {
    return this.store.get(definitionId);
  }

  listStates(): VersionState[] {
    return this.store.list();
  }

  checkForUpdate(definitionId: string): UpdateStatus {
    const state = this.store.get(definitionId);
    if (!state) {
      throw new Error(`No installed version found for ${definitionId}`);
    }

    const latestKnownVersion = this.opts.getLatestKnownVersion?.(definitionId);
    const range = this.opts.getCompatibilityRange?.(definitionId);

    const updateAvailable =
      latestKnownVersion !== undefined &&
      compareVersions(latestKnownVersion, state.installedVersion) > 0;

    const latestCompatibility = latestKnownVersion
      ? checkCompatibility(latestKnownVersion, range)
      : undefined;

    return {
      definitionId,
      installedVersion: state.installedVersion,
      latestKnownVersion,
      updateAvailable,
      latestCompatibility,
    };
  }

  async performUpdate(input: {
    definitionId: string;
    targetVersion?: string;
    sourcePath?: string;
    installDir?: string;
    model?: string;
  }): Promise<UpdateValidationResult> {
    const state = this.store.get(input.definitionId);
    if (!state) {
      throw new Error(`No installed version found for ${input.definitionId}`);
    }

    const fromVersion = state.installedVersion;

    const targetVersion =
      input.targetVersion ?? this.opts.getLatestKnownVersion?.(input.definitionId);

    if (!targetVersion) {
      const compatibility: CompatibilityResult = {
        version: "",
        status: "unknown",
        notes: [],
      };
      return {
        success: false,
        definitionId: input.definitionId,
        fromVersion,
        compatibility,
        activated: false,
        reason: "no target version",
      };
    }

    const range = this.opts.getCompatibilityRange?.(input.definitionId);
    const compatibility = checkCompatibility(targetVersion, range);

    if (compatibility.status !== "supported") {
      this.store.upsert({
        definitionId: input.definitionId,
        installedVersion: fromVersion,
        latestKnownVersion: targetVersion,
        compatibilityStatus: "incompatible",
        knownGoodVersion: state.knownGoodVersion,
        notes: [`Rejected update to ${targetVersion}: ${compatibility.reason ?? "not supported"}`],
      });

      return {
        success: false,
        definitionId: input.definitionId,
        fromVersion,
        targetVersion,
        compatibility,
        activated: false,
        reason: `Target version ${targetVersion} is not supported: ${compatibility.reason ?? "incompatible"}`,
      };
    }

    const installResult = this.opts.installOrUpdate({
      definitionId: input.definitionId,
      targetVersion,
      sourcePath: input.sourcePath,
      installDir: input.installDir,
    });

    if (!installResult.success) {
      this.store.upsert({
        definitionId: input.definitionId,
        installedVersion: fromVersion,
        latestKnownVersion: targetVersion,
        compatibilityStatus: "incompatible",
        knownGoodVersion: state.knownGoodVersion,
        notes: [`Install failed: ${installResult.error ?? "unknown error"}`],
      });

      return {
        success: false,
        definitionId: input.definitionId,
        fromVersion,
        targetVersion,
        compatibility,
        activated: false,
        reason: `Install failed: ${installResult.error ?? "unknown error"}`,
      };
    }

    const versionCommand = this.opts.getVersionCommand(input.definitionId);
    if (!versionCommand || versionCommand.length === 0) {
      return {
        success: false,
        definitionId: input.definitionId,
        fromVersion,
        targetVersion,
        compatibility,
        activated: false,
        reason: "No version command configured",
      };
    }

    const binaryPath = installResult.path ?? input.installDir ?? "";
    const detection = detectVersion(binaryPath, versionCommand);

    if (!detection.detected || detection.version !== targetVersion) {
      return {
        success: false,
        definitionId: input.definitionId,
        fromVersion,
        targetVersion,
        compatibility,
        verifiedVersion: detection.version,
        activated: false,
        reason: detection.detected
          ? `Version mismatch: expected ${targetVersion}, got ${detection.version}`
          : `Version detection failed: ${detection.error}`,
      };
    }

    const adapter = this.opts.getAdapter?.(input.definitionId);
    if (!adapter) {
      return {
        success: false,
        definitionId: input.definitionId,
        fromVersion,
        targetVersion,
        compatibility,
        verifiedVersion: detection.version,
        activated: false,
        reason: "No adapter available for contract test",
      };
    }

    const contractTest = await runAdapterContractTest(adapter, input.model);
    if (!contractTest.ok) {
      return {
        success: false,
        definitionId: input.definitionId,
        fromVersion,
        targetVersion,
        compatibility,
        verifiedVersion: detection.version,
        contractTest,
        activated: false,
        reason: `Contract test failed: ${contractTest.message}`,
      };
    }

    const health = await adapter.health();
    if (!health.ok) {
      return {
        success: false,
        definitionId: input.definitionId,
        fromVersion,
        targetVersion,
        compatibility,
        verifiedVersion: detection.version,
        contractTest,
        health,
        activated: false,
        reason: `Post-update health check failed: ${health.message ?? "not ok"}`,
      };
    }

    this.store.upsert({
      definitionId: input.definitionId,
      installedVersion: targetVersion,
      latestKnownVersion: targetVersion,
      compatibilityStatus: "supported",
      knownGoodVersion: targetVersion,
      notes: [],
    });

    return {
      success: true,
      definitionId: input.definitionId,
      fromVersion,
      targetVersion,
      compatibility,
      verifiedVersion: detection.version,
      contractTest,
      health,
      activated: true,
    };
  }
}
