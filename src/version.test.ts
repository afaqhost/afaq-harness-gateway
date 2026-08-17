import { describe, it, expect } from "vitest";
import { GATEWAY_VERSION } from "./version.js";

describe("GATEWAY_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof GATEWAY_VERSION).toBe("string");
    expect(GATEWAY_VERSION.length).toBeGreaterThan(0);
  });

  it("matches a semver-like pattern", () => {
    expect(GATEWAY_VERSION).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });
});
