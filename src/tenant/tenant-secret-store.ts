import type { SecretStore } from "../credentials/secret-store.js";

export class TenantSecretBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantSecretBoundaryError";
  }
}

export function tenantSecretRef(tenantId: string, ref: string): string {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("tenantId must be a non-empty string");
  }
  if (typeof ref !== "string" || ref.length === 0) {
    throw new Error("ref must be a non-empty string");
  }
  return `tenant:${tenantId}:${ref}`;
}

export class TenantSecretStore implements SecretStore {
  private readonly prefix: string;

  constructor(
    private readonly tenantId: string,
    private readonly backing: SecretStore,
  ) {
    if (typeof tenantId !== "string" || tenantId.length === 0) {
      throw new Error("tenantId must be a non-empty string");
    }
    this.prefix = `tenant:${tenantId}:`;
  }

  private enforceBoundary(ref: string): string {
    if (!ref.startsWith(this.prefix)) {
      throw new TenantSecretBoundaryError(
        `Secret ref "${ref}" is outside tenant boundary for tenant "${this.tenantId}"`,
      );
    }
    return ref;
  }

  has(ref: string): boolean {
    return this.backing.has(this.enforceBoundary(ref));
  }

  get(ref: string): string | undefined {
    return this.backing.get(this.enforceBoundary(ref));
  }

  set(ref: string, material: string): void {
    this.backing.set(this.enforceBoundary(ref), material);
  }

  delete(ref: string): boolean {
    return this.backing.delete(this.enforceBoundary(ref));
  }
}
