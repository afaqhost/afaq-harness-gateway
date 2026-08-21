export type LifecycleState =
  | "discovered"
  | "available"
  | "installed"
  | "configured"
  | "authenticated"
  | "enabled"
  | "healthy"
  | "disabled"
  | "unhealthy"
  | "update_available"
  | "removed";

export type LifecycleEvent =
  | "probe_succeeded"
  | "install"
  | "configure"
  | "authenticate"
  | "enable"
  | "disable"
  | "health_check_passed"
  | "health_check_failed"
  | "update_found"
  | "update_applied"
  | "update_ignored"
  | "remove";

export const INITIAL_LIFECYCLE_STATE: LifecycleState = "discovered";

const TRANSITIONS: Record<LifecycleState, Partial<Record<LifecycleEvent, LifecycleState>>> = {
  discovered: {
    probe_succeeded: "available",
    remove: "removed",
  },
  available: {
    install: "installed",
    remove: "removed",
  },
  installed: {
    configure: "configured",
    update_found: "update_available",
    remove: "removed",
  },
  configured: {
    authenticate: "authenticated",
    update_found: "update_available",
    remove: "removed",
  },
  authenticated: {
    enable: "enabled",
    update_found: "update_available",
    remove: "removed",
  },
  enabled: {
    health_check_passed: "healthy",
    health_check_failed: "unhealthy",
    disable: "disabled",
    update_found: "update_available",
    remove: "removed",
  },
  healthy: {
    health_check_failed: "unhealthy",
    disable: "disabled",
    update_found: "update_available",
    remove: "removed",
  },
  unhealthy: {
    health_check_passed: "enabled",
    disable: "disabled",
    update_found: "update_available",
    remove: "removed",
  },
  disabled: {
    enable: "enabled",
    update_found: "update_available",
    remove: "removed",
  },
  update_available: {
    update_applied: "installed",
    update_ignored: "installed",
    remove: "removed",
  },
  removed: {},
};

export function transitionLifecycle(state: LifecycleState, event: LifecycleEvent): LifecycleState {
  const next = TRANSITIONS[state]?.[event];
  if (next === undefined) {
    throw new Error(`invalid transition: ${state} + ${event}`);
  }
  return next;
}
