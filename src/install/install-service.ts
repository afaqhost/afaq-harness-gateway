import type {
  InstallDefinition,
  InstallInput,
  InstallResult,
  InstallRecord,
  HealthResult,
  DiscoveryResult,
  VersionDetectionResult,
  VersionValidationResult,
  InstallStrategy,
} from "./types.js";
import { discoverBinary } from "./discovery.js";
import { detectVersion, validateVersion } from "./version.js";
import { checkHealth } from "./health.js";
import { CopyBinaryStrategy } from "./strategies.js";
import { InstallStore } from "./store.js";

export class InstallService {
  private definitions = new Map<string, InstallDefinition>();
  private strategies = new Map<string, InstallStrategy>();
  private store: InstallStore;

  constructor(store: InstallStore) {
    this.store = store;
    this.registerStrategy(new CopyBinaryStrategy());
  }

  registerDefinition(definition: InstallDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Definition "${definition.id}" is already registered`);
    }
    this.definitions.set(definition.id, definition);
  }

  registerStrategy(strategy: InstallStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  getDefinition(id: string): InstallDefinition | undefined {
    return this.definitions.get(id);
  }

  listDefinitions(): InstallDefinition[] {
    return [...this.definitions.values()];
  }

  discover(definitionId: string, candidateDirs?: string[]): DiscoveryResult {
    const definition = this.definitions.get(definitionId);
    if (!definition) {
      return { found: false, error: `Unknown definition: ${definitionId}` };
    }
    return discoverBinary(definition.binaryName, candidateDirs);
  }

  detectVersion(definitionId: string, binaryPath: string): VersionDetectionResult {
    const definition = this.definitions.get(definitionId);
    if (!definition) {
      return { detected: false, error: `Unknown definition: ${definitionId}` };
    }
    return detectVersion(binaryPath, definition.versionCommand);
  }

  validateVersion(definitionId: string, detectedVersion: string): VersionValidationResult {
    const definition = this.definitions.get(definitionId);
    if (!definition) {
      return { supported: false, reason: `Unknown definition: ${definitionId}` };
    }
    return validateVersion(detectedVersion, definition.versionPolicy);
  }

  install(input: InstallInput): InstallResult {
    const definition = this.definitions.get(input.definitionId);
    if (!definition) {
      return { success: false, error: `Unknown definition: ${input.definitionId}` };
    }

    const strategy = this.strategies.get(input.strategy);
    if (!strategy) {
      return { success: false, error: `Unknown strategy: ${input.strategy}` };
    }

    const result = strategy.execute({
      definition,
      sourcePath: input.sourcePath,
      installDir: input.installDir,
    });

    if (!result.success || !result.record) {
      return result;
    }

    const versionResult = detectVersion(result.record.path, definition.versionCommand);
    const version = versionResult.detected ? versionResult.version! : "unknown";

    const validation = validateVersion(version, definition.versionPolicy);
    if (!validation.supported) {
      return {
        success: false,
        error: `Post-install version check failed: ${validation.reason}`,
      };
    }

    const record = this.store.createRecord({
      id: result.record.id,
      definitionId: definition.id,
      path: result.record.path,
      version,
      strategy: input.strategy,
      state: "verified",
      checksum: result.record.checksum,
    });

    return { success: true, record };
  }

  health(recordId: string): HealthResult {
    const record = this.store.getRecord(recordId);
    if (!record) {
      return { ok: false, message: `Installation record not found: ${recordId}` };
    }

    const definition = this.definitions.get(record.definitionId);
    if (!definition) {
      return { ok: false, message: `Definition not found: ${record.definitionId}` };
    }

    return checkHealth(record, definition);
  }

  listRecords(): InstallRecord[] {
    return this.store.listRecords();
  }

  listByDefinition(definitionId: string): InstallRecord[] {
    return this.store.listByDefinition(definitionId);
  }

  getRecord(id: string): InstallRecord | undefined {
    return this.store.getRecord(id);
  }

  removeRecord(id: string): boolean {
    const record = this.store.getRecord(id);
    if (!record) return false;
    this.store.updateState(id, "removed");
    return true;
  }
}
