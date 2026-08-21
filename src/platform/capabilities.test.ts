import { describe, it, expect } from "vitest";
import {
  CAPABILITIES,
  capabilitySet,
  hasCapability,
  mergeCapabilities,
} from "./capabilities.js";
import type { Capability, CapabilitySet } from "./capabilities.js";

describe("CAPABILITIES", () => {
  it("contains exactly the six expected strings", () => {
    expect([...CAPABILITIES]).toEqual([
      "streaming",
      "sessions",
      "usage",
      "tool_events",
      "cancellation",
      "model_selection",
    ]);
  });
});

describe("capabilitySet", () => {
  it("creates a set from the given capabilities", () => {
    const set = capabilitySet("streaming", "usage");
    expect(set.size).toBe(2);
    expect(set.has("streaming")).toBe(true);
    expect(set.has("usage")).toBe(true);
  });

  it("creates an empty set when called with no arguments", () => {
    const set = capabilitySet();
    expect(set.size).toBe(0);
  });
});

describe("hasCapability", () => {
  it("returns true for present capabilities", () => {
    const set = capabilitySet("streaming", "sessions");
    expect(hasCapability(set, "streaming")).toBe(true);
    expect(hasCapability(set, "sessions")).toBe(true);
  });

  it("returns false for absent capabilities", () => {
    const set = capabilitySet("streaming");
    expect(hasCapability(set, "usage")).toBe(false);
  });
});

describe("mergeCapabilities", () => {
  it("returns the union of all input sets", () => {
    const a = capabilitySet("streaming", "sessions");
    const b = capabilitySet("usage", "sessions");
    const c = capabilitySet("cancellation");
    const merged = mergeCapabilities(a, b, c);
    expect([...merged]).toEqual(
      expect.arrayContaining(["streaming", "sessions", "usage", "cancellation"]),
    );
    expect(merged.size).toBe(4);
  });

  it("does not mutate its inputs", () => {
    const a = capabilitySet("streaming");
    const b = capabilitySet("usage");
    const aSnapshot = new Set(a);
    const bSnapshot = new Set(b);
    mergeCapabilities(a, b);
    expect(new Set(a)).toEqual(aSnapshot);
    expect(new Set(b)).toEqual(bSnapshot);
  });

  it("returns an empty set when called with no arguments", () => {
    const merged = mergeCapabilities();
    expect(merged.size).toBe(0);
  });
});
