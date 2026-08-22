import type { Tenant, TenantState } from "./types.js";

export type TenantLifecycleEvent = "provision" | "activate" | "suspend" | "resume" | "remove";

const TRANSITIONS: Record<TenantState, Partial<Record<TenantLifecycleEvent, TenantState>>> = {
  provisioning: { activate: "active", remove: "removed" },
  active: { suspend: "suspended", remove: "removed" },
  suspended: { resume: "active", remove: "removed" },
  removed: {},
};

export function transitionTenantState(state: TenantState, event: TenantLifecycleEvent): TenantState {
  const next = TRANSITIONS[state]?.[event];
  if (next === undefined) {
    throw new Error(`invalid tenant transition: ${state} + ${event}`);
  }
  return next;
}

export class TenantLifecycle {
  private readonly states = new Map<string, TenantState>();

  provision(tenant: Tenant): TenantState {
    if (this.states.has(tenant.id)) {
      throw new Error(`tenant "${tenant.id}" already exists`);
    }
    this.states.set(tenant.id, "provisioning");
    return "provisioning";
  }

  activate(id: string): TenantState {
    return this.apply(id, "activate");
  }

  suspend(id: string): TenantState {
    return this.apply(id, "suspend");
  }

  resume(id: string): TenantState {
    return this.apply(id, "resume");
  }

  remove(id: string): TenantState {
    return this.apply(id, "remove");
  }

  state(id: string): TenantState {
    const s = this.states.get(id);
    if (s === undefined) {
      throw new Error(`unknown tenant "${id}"`);
    }
    return s;
  }

  private apply(id: string, event: TenantLifecycleEvent): TenantState {
    const current = this.states.get(id);
    if (current === undefined) {
      throw new Error(`unknown tenant "${id}"`);
    }
    const next = transitionTenantState(current, event);
    this.states.set(id, next);
    return next;
  }
}
