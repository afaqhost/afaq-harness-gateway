import type { HarnessPlatform, ResolvedRuntime } from "./harness-platform.js";
import type { HarnessInstallation, CredentialProfile } from "./entities.js";
import type { CapabilitySet } from "./capabilities.js";
import type { AdapterRegistry } from "../core/adapter-registry.js";
import type { SecretStore } from "../credentials/secret-store.js";
import { checkAuthenticationStatus, type AuthenticationStatus } from "../credentials/auth-status.js";

export class HarnessLifecycleError extends Error {}
export class InstallationNotFoundError extends HarnessLifecycleError {}
export class CredentialProfileNotFoundError extends HarnessLifecycleError {}

export interface InstallationHealth {
  installationId: string;
  ok: boolean;
  message?: string;
}

export interface HarnessLifecycleServiceOptions {
  platform: HarnessPlatform;
  secretStore: SecretStore;
  adapterRegistry?: AdapterRegistry;
}

export class HarnessLifecycleService {
  private platform: HarnessPlatform;
  private secretStore: SecretStore;
  private adapterRegistry?: AdapterRegistry;

  constructor(options: HarnessLifecycleServiceOptions) {
    this.platform = options.platform;
    this.secretStore = options.secretStore;
    this.adapterRegistry = options.adapterRegistry;
  }

  listInstallations(): HarnessInstallation[] {
    return this.platform.listInstallations();
  }

  listCredentialProfiles(definitionId?: string): CredentialProfile[] {
    const all = this.platform.listCredentialProfiles();
    if (definitionId === undefined) {
      return all;
    }
    return all.filter((p) => p.definitionId === definitionId);
  }

  enableInstallation(id: string): HarnessInstallation {
    const installation = this.platform.getInstallation(id);
    if (!installation) {
      throw new InstallationNotFoundError(`Installation "${id}" is not registered.`);
    }
    if (installation.state === "enabled" || installation.state === "healthy") {
      return installation;
    }
    if (installation.state === "disabled") {
      return this.platform.transitionInstallation(id, "enable");
    }
    throw new HarnessLifecycleError(
      `Installation "${id}" is in state "${installation.state}" and must be configured and authenticated before enabling.`,
    );
  }

  disableInstallation(id: string): HarnessInstallation {
    const installation = this.platform.getInstallation(id);
    if (!installation) {
      throw new InstallationNotFoundError(`Installation "${id}" is not registered.`);
    }
    if (installation.state === "disabled") {
      return installation;
    }
    if (
      installation.state === "enabled" ||
      installation.state === "healthy" ||
      installation.state === "unhealthy"
    ) {
      return this.platform.transitionInstallation(id, "disable");
    }
    throw new HarnessLifecycleError(
      `Installation "${id}" is in state "${installation.state}" and cannot be disabled.`,
    );
  }

  removeInstallation(id: string): HarnessInstallation {
    const installation = this.platform.getInstallation(id);
    if (!installation) {
      throw new InstallationNotFoundError(`Installation "${id}" is not registered.`);
    }
    return this.platform.transitionInstallation(id, "remove");
  }

  selectInstallation(definitionId: string, installationId: string): void {
    const definition = this.platform.getDefinition(definitionId);
    if (!definition) {
      throw new InstallationNotFoundError(`Definition "${definitionId}" is not registered.`);
    }
    const installation = this.platform.getInstallation(installationId);
    if (!installation) {
      throw new InstallationNotFoundError(`Installation "${installationId}" is not registered.`);
    }
    if (installation.definitionId !== definitionId) {
      throw new HarnessLifecycleError(
        `Installation "${installationId}" belongs to definition "${installation.definitionId}", not "${definitionId}".`,
      );
    }
    const instances = this.platform.listInstances();
    const matching = instances.find(
      (inst) =>
        inst.definitionId === definitionId &&
        inst.installationId === installationId &&
        (inst.state === "enabled" || inst.state === "healthy"),
    );
    if (!matching) {
      throw new HarnessLifecycleError(
        `No enabled or healthy instance found for definition "${definitionId}" and installation "${installationId}".`,
      );
    }
    this.platform.setActiveInstance(matching.id);
  }

  selectCredentialProfile(instanceId: string, profileId: string): void {
    const profile = this.platform.getCredentialProfile(profileId);
    if (!profile) {
      throw new CredentialProfileNotFoundError(`Credential profile "${profileId}" is not registered.`);
    }
    this.platform.setCredentialProfile(instanceId, profileId);
  }

  inspectCapabilities(instanceId: string): CapabilitySet {
    const instance = this.platform.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance "${instanceId}" is not registered.`);
    }
    return instance.capabilities;
  }

  async listModels(modelId: string): Promise<string[]> {
    const resolved = this.platform.resolveRuntime(modelId);
    const adapter = this.adapterRegistry?.get(resolved.adapterId);
    if (!adapter) {
      return [];
    }
    return adapter.listModels();
  }

  async healthCheck(installationId: string): Promise<InstallationHealth> {
    const installation = this.platform.getInstallation(installationId);
    if (!installation) {
      throw new InstallationNotFoundError(`Installation "${installationId}" is not registered.`);
    }
    const definition = this.platform.getDefinition(installation.definitionId);
    if (!definition) {
      return { installationId, ok: false, message: "Definition not found for installation." };
    }
    const adapter = this.adapterRegistry?.get(definition.adapterId);
    if (!adapter) {
      return { installationId, ok: false, message: "No adapter available for definition." };
    }
    const health = await adapter.health();
    return { installationId, ...health };
  }

  authenticationStatus(profileId: string): AuthenticationStatus {
    const profile = this.platform.getCredentialProfile(profileId);
    if (!profile) {
      throw new CredentialProfileNotFoundError(`Credential profile "${profileId}" is not registered.`);
    }
    return checkAuthenticationStatus(profile, this.secretStore);
  }
}
