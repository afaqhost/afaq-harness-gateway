import type { HarnessAdapter } from "../harness/types.js";

export type CompatibilityStatus = "supported" | "incompatible" | "unknown";

export interface VersionRange {
  readonly minimum?: string;
  readonly maximum?: string;
  readonly allowed?: readonly string[];
  readonly blocked?: readonly string[];
  readonly notes?: readonly string[];
}

export interface CompatibilityResult {
  readonly version: string;
  readonly status: CompatibilityStatus;
  readonly reason?: string;
  readonly notes: readonly string[];
}

export interface UpdateStatus {
  readonly definitionId: string;
  readonly installedVersion: string;
  readonly latestKnownVersion?: string;
  readonly updateAvailable: boolean;
  readonly latestCompatibility?: CompatibilityResult;
}

export interface VersionState {
  readonly definitionId: string;
  readonly installedVersion: string;
  readonly latestKnownVersion?: string;
  readonly compatibilityStatus: CompatibilityStatus;
  readonly knownGoodVersion?: string;
  readonly notes: readonly string[];
  readonly checkedAt: string;
}

export interface ContractTestResult {
  readonly ok: boolean;
  readonly message?: string;
}

export interface UpdateValidationResult {
  readonly success: boolean;
  readonly definitionId: string;
  readonly fromVersion: string;
  readonly targetVersion?: string;
  readonly compatibility: CompatibilityResult;
  readonly verifiedVersion?: string;
  readonly contractTest?: ContractTestResult;
  readonly health?: { ok: boolean; message?: string };
  readonly activated: boolean;
  readonly reason?: string;
}
