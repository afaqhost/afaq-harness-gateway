import { describe, it, expect } from "vitest";
import { INITIAL_LIFECYCLE_STATE, transitionLifecycle } from "./lifecycle.js";
import type { LifecycleState, LifecycleEvent } from "./lifecycle.js";

describe("INITIAL_LIFECYCLE_STATE", () => {
  it("is 'discovered'", () => {
    expect(INITIAL_LIFECYCLE_STATE).toBe("discovered");
  });
});

describe("transitionLifecycle", () => {
  it("follows the full happy path to healthy", () => {
    let state: LifecycleState = "discovered";
    state = transitionLifecycle(state, "probe_succeeded");
    expect(state).toBe("available");
    state = transitionLifecycle(state, "install");
    expect(state).toBe("installed");
    state = transitionLifecycle(state, "configure");
    expect(state).toBe("configured");
    state = transitionLifecycle(state, "authenticate");
    expect(state).toBe("authenticated");
    state = transitionLifecycle(state, "enable");
    expect(state).toBe("enabled");
    state = transitionLifecycle(state, "health_check_passed");
    expect(state).toBe("healthy");
  });

  it("follows the update flow", () => {
    let state: LifecycleState = "enabled";
    state = transitionLifecycle(state, "update_found");
    expect(state).toBe("update_available");
    state = transitionLifecycle(state, "update_applied");
    expect(state).toBe("installed");
  });

  it("handles health degradation and recovery", () => {
    let state: LifecycleState = "healthy";
    state = transitionLifecycle(state, "health_check_failed");
    expect(state).toBe("unhealthy");
    state = transitionLifecycle(state, "health_check_passed");
    expect(state).toBe("enabled");
  });

  it("handles disable and re-enable", () => {
    let state: LifecycleState = "enabled";
    state = transitionLifecycle(state, "disable");
    expect(state).toBe("disabled");
    state = transitionLifecycle(state, "enable");
    expect(state).toBe("enabled");
  });

  it("supports remove from an operational state", () => {
    const state = transitionLifecycle("enabled", "remove");
    expect(state).toBe("removed");
  });

  it("throws for invalid transitions", () => {
    expect(() => transitionLifecycle("available", "enable")).toThrow(/invalid transition/);
    expect(() => transitionLifecycle("discovered", "install")).toThrow(/invalid transition/);
    expect(() => transitionLifecycle("removed", "enable")).toThrow(/invalid transition/);
  });
});
