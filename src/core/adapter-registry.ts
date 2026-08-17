import type { HarnessAdapter } from "../harness/types.js";

export class AdapterRegistry {
  private adapters = new Map<string, HarnessAdapter>();

  register(adapter: HarnessAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter "${adapter.id}" is already registered.`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): HarnessAdapter | undefined {
    return this.adapters.get(id);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  ids(): string[] {
    return [...this.adapters.keys()];
  }
}
