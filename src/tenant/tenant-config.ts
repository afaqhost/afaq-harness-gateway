export class TenantHarnessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantHarnessConfigError";
  }
}

export interface TenantHarnessConfig {
  readonly definitionId: string;
  readonly config: Record<string, unknown>;
  readonly updatedAt: string;
}

export class TenantConfigStore {
  private readonly store = new Map<string, Record<string, unknown>>();
  private readonly timestamps = new Map<string, string>();

  constructor(private readonly tenantId: string) {
    if (typeof tenantId !== "string" || tenantId.length === 0) {
      throw new TenantHarnessConfigError("tenantId must be a non-empty string");
    }
  }

  setHarnessConfig(definitionId: string, config: Record<string, unknown>): TenantHarnessConfig {
    if (typeof definitionId !== "string" || definitionId.length === 0) {
      throw new TenantHarnessConfigError("definitionId must be a non-empty string");
    }
    const copy = { ...config };
    const now = new Date().toISOString();
    this.store.set(definitionId, copy);
    this.timestamps.set(definitionId, now);
    return { definitionId, config: { ...copy }, updatedAt: now };
  }

  getHarnessConfig(definitionId: string): Record<string, unknown> | undefined {
    const config = this.store.get(definitionId);
    return config ? { ...config } : undefined;
  }

  listHarnessConfigs(): TenantHarnessConfig[] {
    const result: TenantHarnessConfig[] = [];
    for (const [definitionId, config] of this.store) {
      result.push({
        definitionId,
        config: { ...config },
        updatedAt: this.timestamps.get(definitionId)!,
      });
    }
    return result;
  }

  removeHarnessConfig(definitionId: string): boolean {
    this.timestamps.delete(definitionId);
    return this.store.delete(definitionId);
  }
}

export class TenantConfigRegistry {
  private readonly stores = new Map<string, TenantConfigStore>();

  private getStore(tenantId: string): TenantConfigStore {
    const store = this.stores.get(tenantId);
    if (!store) {
      throw new TenantHarnessConfigError(`Unknown tenant "${tenantId}"`);
    }
    return store;
  }

  registerTenant(tenantId: string): void {
    if (this.stores.has(tenantId)) {
      throw new TenantHarnessConfigError(`Tenant "${tenantId}" is already registered`);
    }
    this.stores.set(tenantId, new TenantConfigStore(tenantId));
  }

  setHarnessConfig(
    tenantId: string,
    definitionId: string,
    config: Record<string, unknown>,
  ): TenantHarnessConfig {
    return this.getStore(tenantId).setHarnessConfig(definitionId, config);
  }

  getHarnessConfig(tenantId: string, definitionId: string): Record<string, unknown> | undefined {
    return this.getStore(tenantId).getHarnessConfig(definitionId);
  }

  listHarnessConfigs(tenantId: string): TenantHarnessConfig[] {
    return this.getStore(tenantId).listHarnessConfigs();
  }

  removeHarnessConfig(tenantId: string, definitionId: string): boolean {
    return this.getStore(tenantId).removeHarnessConfig(definitionId);
  }
}
