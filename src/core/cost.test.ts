import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "./cost.js";
import type { Usage } from "../harness/types.js";
import type { Pricing } from "./pricing.js";

describe("estimateCostUsd", () => {
  const pricing: Pricing = { input_rate_per_million: 3.0, output_rate_per_million: 15.0 };

  it("returns 0 for zero usage", () => {
    expect(estimateCostUsd({}, pricing)).toBe(0);
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0 }, pricing)).toBe(0);
  });

  it("computes cost for known token counts", () => {
    const usage: Usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    // (1M / 1M * 3.0) + (1M / 1M * 15.0) = 18.0
    expect(estimateCostUsd(usage, pricing)).toBe(18);
  });

  it("handles partial millions and rounds to 6 decimal places", () => {
    const usage: Usage = { inputTokens: 500_000, outputTokens: 200_000 };
    // (500k/1M * 3.0) + (200k/1M * 15.0) = 1.5 + 3.0 = 4.5
    expect(estimateCostUsd(usage, pricing)).toBe(4.5);
  });

  it("treats missing token fields as zero", () => {
    const usage: Usage = { cachedInputTokens: 1000 };
    expect(estimateCostUsd(usage, pricing)).toBe(0);
  });
});
