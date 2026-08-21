export interface VersionPolicy {
  readonly minimum?: string;
  readonly allowlist?: readonly string[];
}

export interface InstallDefinition {
  readonly id: string;
  readonly name: string;
  readonly binaryName: string;
  readonly versionCommand: readonly string[];
  readonly versionPolicy?: VersionPolicy;
  readonly checksum?: string;
}

export interface DiscoveryResult {
  readonly found: boolean;
  readonly path?: string;
  readonly error?: string;
}

export interface VersionDetectionResult {
  readonly detected: boolean;
  readonly version?: string;
  readonly raw?: string;
  readonly error?: string;
}

export interface VersionValidationResult {
  readonly supported: boolean;
  readonly detectedVersion?: string;
  readonly policy?: VersionPolicy;
  readonly reason?: string;
}

export type InstallStrategyName = "copy";

export type InstallRecordState =
  | "pending"
  | "installed"
  | "verified"
  | "failed"
  | "removed";

export interface InstallRecord {
  readonly id: string;
  readonly definitionId: string;
  readonly path: string;
  readonly version: string;
  readonly strategy: InstallStrategyName;
  readonly state: InstallRecordState;
  readonly checksum?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InstallInput {
  readonly definitionId: string;
  readonly strategy: InstallStrategyName;
  readonly sourcePath?: string;
  readonly installDir: string;
}

export interface InstallResult {
  readonly success: boolean;
  readonly record?: InstallRecord;
  readonly error?: string;
}

export interface HealthResult {
  readonly ok: boolean;
  readonly message?: string;
}

export interface InstallStrategy {
  readonly name: InstallStrategyName;
  execute(input: {
    definition: InstallDefinition;
    sourcePath?: string;
    installDir: string;
  }): InstallResult;
}
