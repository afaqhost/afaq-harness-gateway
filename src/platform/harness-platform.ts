import { parseModelId } from "../core/model-resolution.js";
import type { AdapterRegistry } from "../core/adapter-registry.js";
import type { HarnessAdapter } from "../harness/types.js";
import { transitionLifecycle, type LifecycleEvent } from "./lifecycle.js";
import type { HarnessDefinition, HarnessInstallation, CredentialProfile, HarnessInstance } from "./entities.js";

export class HarnessPlatformError extends Error {}
export class UnknownHarnessError extends HarnessPlatformError {}
export class HarnessNotAvailableError extends HarnessPlatformError {}

export interface ResolvedInstance {
  readonly harness: string;
  readonly model: string;
  readonly adapterId: string;
  readonly instanceId: string;
}

export class HarnessPlatform {
  private adapterRegistry?: AdapterRegistry;
  private definitions = new Map<string, HarnessDefinition>();
  private installations = new Map<string, HarnessInstallation>();
  private credentialProfiles = new Map<string, CredentialProfile>();
  private instances = new Map<string, HarnessInstance>();
  private instanceInsertionOrder: string[] = [];

  constructor(adapterRegistry?: AdapterRegistry) {
    this.adapterRegistry = adapterRegistry;
  }

  registerDefinition(definition: HarnessDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Definition "${definition.id}" is already registered.`);
    }
    this.definitions.set(definition.id, definition);
  }

  registerInstallation(installation: HarnessInstallation): void {
    if (this.installations.has(installation.id)) {
      throw new Error(`Installation "${installation.id}" is already registered.`);
    }
    if (!this.definitions.has(installation.definitionId)) {
      throw new Error(`Definition "${installation.definitionId}" is not registered.`);
    }
    this.installations.set(installation.id, installation);
  }

  registerCredentialProfile(profile: CredentialProfile): void {
    if (this.credentialProfiles.has(profile.id)) {
      throw new Error(`Credential profile "${profile.id}" is already registered.`);
    }
    if (!this.definitions.has(profile.definitionId)) {
      throw new Error(`Definition "${profile.definitionId}" is not registered.`);
    }
    this.credentialProfiles.set(profile.id, profile);
  }

  registerInstance(instance: HarnessInstance): void {
    if (this.instances.has(instance.id)) {
      throw new Error(`Instance "${instance.id}" is already registered.`);
    }
    const definition = this.definitions.get(instance.definitionId);
    if (!definition) {
      throw new Error(`Definition "${instance.definitionId}" is not registered.`);
    }
    if (!this.installations.has(instance.installationId)) {
      throw new Error(`Installation "${instance.installationId}" is not registered.`);
    }
    if (instance.adapterId !== definition.adapterId) {
      throw new Error(
        `Instance adapterId "${instance.adapterId}" does not match definition adapterId "${definition.adapterId}".`,
      );
    }
    if (instance.credentialProfileId !== undefined && !this.credentialProfiles.has(instance.credentialProfileId)) {
      throw new Error(`Credential profile "${instance.credentialProfileId}" is not registered.`);
    }
    this.instances.set(instance.id, instance);
    this.instanceInsertionOrder.push(instance.id);
  }

  listDefinitions(): HarnessDefinition[] {
    return [...this.definitions.values()];
  }

  listInstallations(): HarnessInstallation[] {
    return [...this.installations.values()];
  }

  listCredentialProfiles(): CredentialProfile[] {
    return [...this.credentialProfiles.values()];
  }

  listInstances(): HarnessInstance[] {
    return this.instanceInsertionOrder.map((id) => this.instances.get(id)!);
  }

  getDefinition(id: string): HarnessDefinition | undefined {
    return this.definitions.get(id);
  }

  getInstallation(id: string): HarnessInstallation | undefined {
    return this.installations.get(id);
  }

  getCredentialProfile(id: string): CredentialProfile | undefined {
    return this.credentialProfiles.get(id);
  }

  getInstance(id: string): HarnessInstance | undefined {
    return this.instances.get(id);
  }

  transitionInstallation(id: string, event: LifecycleEvent): HarnessInstallation {
    const installation = this.installations.get(id);
    if (!installation) {
      throw new Error(`Installation "${id}" is not registered.`);
    }
    const newState = transitionLifecycle(installation.state, event);
    const updated: HarnessInstallation = { ...installation, state: newState };
    this.installations.set(id, updated);
    return updated;
  }

  resolveModel(modelId: string): ResolvedInstance {
    const { harness, model } = parseModelId(modelId);
    const candidates = this.instanceInsertionOrder
      .map((id) => this.instances.get(id)!)
      .filter((inst) => inst.definitionId === harness);

    if (candidates.length === 0) {
      throw new UnknownHarnessError(`No instances registered for harness "${harness}".`);
    }

    const active = candidates.find((inst) => inst.state === "healthy" || inst.state === "enabled");
    if (!active) {
      throw new HarnessNotAvailableError(
        `No healthy or enabled instances for harness "${harness}".`,
      );
    }

    return { harness, model, adapterId: active.adapterId, instanceId: active.id };
  }

  getAdapter(modelId: string): HarnessAdapter | undefined {
    const resolved = this.resolveModel(modelId);
    return this.adapterRegistry?.get(resolved.adapterId);
  }
}
