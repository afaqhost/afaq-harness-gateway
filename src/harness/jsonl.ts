import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export class JsonlParseError extends Error {
  constructor(
    public readonly line: string,
    public readonly lineNumber: number,
    cause?: unknown,
  ) {
    super(`Failed to parse JSONL line ${lineNumber}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "JsonlParseError";
  }
}

export async function* parseNdjson(stream: Readable): AsyncGenerator<Record<string, unknown>> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;
    const trimmed = line.trim();
    if (trimmed === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new JsonlParseError(trimmed, lineNumber, err);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new JsonlParseError(trimmed, lineNumber, new Error("Expected a JSON object"));
    }

    yield parsed as Record<string, unknown>;
  }
}
