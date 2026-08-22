import type { Tenant } from "./types.js";
import { assertWithinTenant } from "./paths.js";

export class TenantRegistry {
  private readonly tenants = new Map<string, Tenant>();

  register(tenant: Tenant): void {
    if (this.tenants.has(tenant.id)) {
      throw new Error(`Tenant with id "${tenant.id}" is already registered`);
    }

    for (const existing of this.tenants.values()) {
      try {
        assertWithinTenant(existing.rootDir, tenant.rootDir);
        throw new Error(
          `Tenant root "${tenant.rootDir}" overlaps with existing tenant "${existing.id}" root "${existing.rootDir}"`,
        );
      } catch (err) {
        if (err instanceof Error && err.message.includes("overlaps with existing")) {
          throw err;
        }
      }

      try {
        assertWithinTenant(tenant.rootDir, existing.rootDir);
        throw new Error(
          `Tenant root "${tenant.rootDir}" overlaps with existing tenant "${existing.id}" root "${existing.rootDir}"`,
        );
      } catch (err) {
        if (err instanceof Error && err.message.includes("overlaps with existing")) {
          throw err;
        }
      }
    }

    this.tenants.set(tenant.id, tenant);
  }

  get(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }

  list(): Tenant[] {
    return [...this.tenants.values()];
  }

  has(id: string): boolean {
    return this.tenants.has(id);
  }

  remove(id: string): boolean {
    return this.tenants.delete(id);
  }
}
