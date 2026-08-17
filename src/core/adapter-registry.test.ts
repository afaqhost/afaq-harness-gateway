import { describe, it, expect } from "vitest";
import { AdapterRegistry } from "./adapter-registry.js";
import type { HarnessAdapter } from "../harness/types.js";

function makeAdapter(id: string): HarnessAdapter {
  return {
    id,
    health: async () => ({ ok: true }),
    listModels: async () => [],
    async *run() {},
    async cancel() {},
  };
}

describe("AdapterRegistry", () => {
  it("registers and looks up an adapter by id", () => {
    const registry = new AdapterRegistry();
    registry.register(makeAdapter("fake-harness"));
    expect(registry.get("fake-harness")?.id).toBe("fake-harness");
    expect(registry.has("fake-harness")).toBe(true);
  });

  it("returns undefined for unknown id", () => {
    const registry = new AdapterRegistry();
    expect(registry.get("unknown")).toBeUndefined();
    expect(registry.has("unknown")).toBe(false);
  });

  it("lists registered ids", () => {
    const registry = new AdapterRegistry();
    registry.register(makeAdapter("a"));
    registry.register(makeAdapter("b"));
    expect(registry.ids().sort()).toEqual(["a", "b"]);
  });

  it("rejects duplicate registration", () => {
    const registry = new AdapterRegistry();
    registry.register(makeAdapter("a"));
    expect(() => registry.register(makeAdapter("a"))).toThrow(/already registered/);
  });
});
