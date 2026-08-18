export interface Pricing {
  input_rate_per_million: number;
  output_rate_per_million: number;
}

/**
 * Default pricing estimates used when no model-specific override exists.
 * These are configurable estimates — adjust per deployment.
 */
export const DEFAULT_PRICING: Pricing = {
  input_rate_per_million: 3.0,
  output_rate_per_million: 15.0,
};

export class PricingRegistry {
  private readonly overrides: Record<string, Pricing>;

  constructor(overrides: Record<string, Pricing> = {}) {
    this.overrides = overrides;
  }

  get(modelId: string): Pricing {
    const override = this.overrides[modelId];
    return override ?? DEFAULT_PRICING;
  }
}
