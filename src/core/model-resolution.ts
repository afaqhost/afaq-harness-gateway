export interface ResolvedModel {
  harness: string;
  model: string;
}

export class ModelResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelResolutionError";
  }
}

export function parseModelId(modelId: string): ResolvedModel {
  const segments = modelId.split("/").filter((segment) => segment.length > 0);

  if (segments.length < 2) {
    throw new ModelResolutionError(
      `Invalid model id "${modelId}": expected "<harness>/<model>" or "<harness>/<provider>/<model>".`,
    );
  }

  const [harness, ...modelSegments] = segments;
  return { harness, model: modelSegments.join("/") };
}

export interface AliasLookup {
  (alias: string): string | undefined;
}

export function resolveModelId(modelId: string, lookupAlias: AliasLookup): ResolvedModel {
  const canonical = lookupAlias(modelId) ?? modelId;
  return parseModelId(canonical);
}
