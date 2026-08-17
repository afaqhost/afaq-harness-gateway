import { describe, it, expect } from "vitest";
import { parseModelId, resolveModelId, ModelResolutionError } from "./model-resolution.js";

describe("parseModelId", () => {
  it("parses a 2-segment id", () => {
    expect(parseModelId("command-code/deepseek")).toEqual({ harness: "command-code", model: "deepseek" });
  });

  it("parses a 3-segment id", () => {
    expect(parseModelId("command-code/deepseek/deepseek-v4-flash")).toEqual({
      harness: "command-code",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("parses a 4-segment id by keeping everything after the harness", () => {
    expect(parseModelId("harness/a/b/c")).toEqual({ harness: "harness", model: "a/b/c" });
  });

  it("rejects a 1-segment id", () => {
    expect(() => parseModelId("gpt-4")).toThrow(ModelResolutionError);
  });

  it("rejects an empty id", () => {
    expect(() => parseModelId("")).toThrow(ModelResolutionError);
  });

  it("rejects an id with only slashes", () => {
    expect(() => parseModelId("///")).toThrow(ModelResolutionError);
  });

  it("rejects an id with an empty harness segment", () => {
    expect(() => parseModelId("/model")).toThrow(ModelResolutionError);
  });
});

describe("resolveModelId", () => {
  it("resolves a canonical id without alias", () => {
    expect(resolveModelId("command-code/deepseek", () => undefined)).toEqual({
      harness: "command-code",
      model: "deepseek",
    });
  });

  it("resolves an alias before parsing", () => {
    const aliases: Record<string, string> = {
      cc: "command-code/deepseek/deepseek-v4-flash",
    };
    expect(resolveModelId("cc", (a) => aliases[a])).toEqual({
      harness: "command-code",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("throws when an alias maps to an invalid model", () => {
    expect(() => resolveModelId("bad", () => "not-valid")).toThrow(ModelResolutionError);
  });
});
