import type { CapabilitySet } from "./capabilities.js";
import type { LifecycleState } from "./lifecycle.js";
import { INITIAL_LIFECYCLE_STATE } from "./lifecycle.js";

export interface HarnessDefinition {
  readonly id: string;
  readonly name: string;
  readonly adapterId: string;
  readonly capabilities: CapabilitySet;
}

export interface HarnessInstallation {
  readonly id: string;
  readonly definitionId: string;
  readonly version: string;
  readonly path: string;
  readonly state: LifecycleState;
}

export interface CredentialProfile {
  readonly id: string;
  readonly name: string;
  readonly definitionId: string;
  readonly secretRef: string;
}

export interface HarnessInstance {
  readonly id: string;
  readonly definitionId: string;
  readonly installationId: string;
  readonly credentialProfileId?: string;
  readonly adapterId: string;
  readonly models: readonly string[];
  readonly capabilities: CapabilitySet;
  readonly state: LifecycleState;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

export function createDefinition(input: {
  id: string;
  name: string;
  adapterId: string;
  capabilities?: CapabilitySet;
}): HarnessDefinition {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.name, "name");
  assertNonEmpty(input.adapterId, "adapterId");
  return {
    id: input.id,
    name: input.name,
    adapterId: input.adapterId,
    capabilities: input.capabilities ?? new Set(),
  };
}

export function createInstallation(input: {
  id: string;
  definitionId: string;
  version: string;
  path: string;
  state?: LifecycleState;
}): HarnessInstallation {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.definitionId, "definitionId");
  assertNonEmpty(input.version, "version");
  assertNonEmpty(input.path, "path");
  return {
    id: input.id,
    definitionId: input.definitionId,
    version: input.version,
    path: input.path,
    state: input.state ?? INITIAL_LIFECYCLE_STATE,
  };
}

export function createCredentialProfile(input: {
  id: string;
  name: string;
  definitionId: string;
  secretRef: string;
}): CredentialProfile {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.name, "name");
  assertNonEmpty(input.definitionId, "definitionId");
  assertNonEmpty(input.secretRef, "secretRef");
  return {
    id: input.id,
    name: input.name,
    definitionId: input.definitionId,
    secretRef: input.secretRef,
  };
}

export function createInstance(input: {
  id: string;
  definitionId: string;
  installationId: string;
  adapterId: string;
  models?: readonly string[];
  capabilities?: CapabilitySet;
  credentialProfileId?: string;
  state?: LifecycleState;
}): HarnessInstance {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.definitionId, "definitionId");
  assertNonEmpty(input.installationId, "installationId");
  assertNonEmpty(input.adapterId, "adapterId");
  return {
    id: input.id,
    definitionId: input.definitionId,
    installationId: input.installationId,
    adapterId: input.adapterId,
    models: input.models ?? [],
    capabilities: input.capabilities ?? new Set(),
    credentialProfileId: input.credentialProfileId,
    state: input.state ?? "enabled",
  };
}
