import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseNdjson, JsonlParseError } from "./jsonl.js";

function streamFromString(s: string): Readable {
  return Readable.from(Buffer.from(s));
}

async function collect(stream: Readable): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  for await (const obj of parseNdjson(stream)) {
    results.push(obj);
  }
  return results;
}

describe("parseNdjson", () => {
  it("parses valid JSON lines", async () => {
    const stream = streamFromString('{"a":1}\n{"b":2}\n{"c":3}\n');
    const result = await collect(stream);
    expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("tolerates trailing blank lines", async () => {
    const stream = streamFromString('{"a":1}\n\n\n{"b":2}\n\n');
    const result = await collect(stream);
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("tolerates lines with only whitespace", async () => {
    const stream = streamFromString('{"a":1}\n   \n\t\n{"b":2}\n');
    const result = await collect(stream);
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("handles empty input", async () => {
    const stream = streamFromString("");
    const result = await collect(stream);
    expect(result).toEqual([]);
  });

  it("handles single line without trailing newline", async () => {
    const stream = streamFromString('{"a":1}');
    const result = await collect(stream);
    expect(result).toEqual([{ a: 1 }]);
  });

  it("throws JsonlParseError on malformed JSON", async () => {
    const stream = streamFromString('{"a":1}\nnot json\n{"b":2}\n');
    await expect(collect(stream)).rejects.toBeInstanceOf(JsonlParseError);
  });

  it("throws JsonlParseError with line number context", async () => {
    const stream = streamFromString('{"a":1}\n{"b":2}\nbad\n');
    try {
      await collect(stream);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonlParseError);
      const parseErr = err as JsonlParseError;
      expect(parseErr.lineNumber).toBe(3);
      expect(parseErr.line).toBe("bad");
    }
  });

  it("throws JsonlParseError on JSON array (not object)", async () => {
    const stream = streamFromString('[1,2,3]\n');
    await expect(collect(stream)).rejects.toBeInstanceOf(JsonlParseError);
  });

  it("throws JsonlParseError on JSON null", async () => {
    const stream = streamFromString("null\n");
    await expect(collect(stream)).rejects.toBeInstanceOf(JsonlParseError);
  });

  it("throws JsonlParseError on JSON string primitive", async () => {
    const stream = streamFromString('"hello"\n');
    await expect(collect(stream)).rejects.toBeInstanceOf(JsonlParseError);
  });

  it("parses nested objects", async () => {
    const obj = { type: "completed", text: "hello", usage: { inputTokens: 10, outputTokens: 5 } };
    const stream = streamFromString(JSON.stringify(obj) + "\n");
    const result = await collect(stream);
    expect(result).toEqual([obj]);
  });

  it("reports line context for the malformed-lines.ndjson fixture", async () => {
    const fixture = resolve(
      import.meta.dirname,
      "../../testing/fixtures/command-code/malformed-lines.ndjson",
    );
    const raw = readFileSync(fixture, "utf-8");
    const stream = Readable.from(Buffer.from(raw));

    let error: unknown;
    try {
      await collect(stream);
      expect.unreachable("Should have thrown");
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(JsonlParseError);
    const parseErr = error as JsonlParseError;
    expect(parseErr.lineNumber).toBe(2);
    expect(parseErr.line).toBe("this is not json");
  });
});
