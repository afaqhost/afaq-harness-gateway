import type { Usage } from "../harness/types.js";
import type { Pricing } from "./pricing.js";

export function estimateCostUsd(usage: Usage, pricing: Pricing): number {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const raw =
    (inputTokens / 1_000_000) * pricing.input_rate_per_million +
    (outputTokens / 1_000_000) * pricing.output_rate_per_million;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
