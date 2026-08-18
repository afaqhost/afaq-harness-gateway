import { describe, it, expect } from "vitest";
import { PricingRegistry, DEFAULT_PRICING } from "./pricing.js";

describe("PricingRegistry", () => {
  it("returns the override for a known model", () => {
    const custom = { input_rate_per_million: 1.0, output_rate_per_million: 2.0 };
    const registry = new PricingRegistry({ "harness/model-a": custom });
    expect(registry.get("harness/model-a")).toBe(custom);
  });

  it("falls back to DEFAULT_PRICING for an unknown model", () => {
    const registry = new PricingRegistry({ "harness/model-a": { input_rate_per_million: 1, output_rate_per_million: 2 } });
    expect(registry.get("harness/other")).toBe(DEFAULT_PRICING);
  });

  it("uses DEFAULT_PRICING when no overrides are provided", () => {
    const registry = new PricingRegistry();
    expect(registry.get("any/model")).toBe(DEFAULT_PRICING);
  });
});
