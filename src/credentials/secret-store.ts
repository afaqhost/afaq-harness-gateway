export interface SecretStore {
  has(ref: string): boolean;
  get(ref: string): string | undefined;
  set(ref: string, material: string): void;
  delete(ref: string): boolean;
}

export class InMemorySecretStore implements SecretStore {
  private store = new Map<string, string>();

  has(ref: string): boolean {
    return this.store.has(ref);
  }

  get(ref: string): string | undefined {
    return this.store.get(ref);
  }

  set(ref: string, material: string): void {
    if (ref.length === 0) {
      throw new Error("Secret ref must be a non-empty string.");
    }
    if (material.length === 0) {
      throw new Error("Secret material must be a non-empty string.");
    }
    this.store.set(ref, material);
  }

  delete(ref: string): boolean {
    return this.store.delete(ref);
  }
}
