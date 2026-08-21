export const CAPABILITIES = [
  "streaming",
  "sessions",
  "usage",
  "tool_events",
  "cancellation",
  "model_selection",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type CapabilitySet = ReadonlySet<Capability>;

export function capabilitySet(...capabilities: Capability[]): CapabilitySet {
  return new Set(capabilities);
}

export function hasCapability(set: CapabilitySet, capability: Capability): boolean {
  return set.has(capability);
}

export function mergeCapabilities(...sets: CapabilitySet[]): CapabilitySet {
  const merged = new Set<Capability>();
  for (const set of sets) {
    for (const cap of set) {
      merged.add(cap);
    }
  }
  return merged;
}
