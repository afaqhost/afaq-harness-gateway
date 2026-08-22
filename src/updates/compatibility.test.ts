import { describe, it, expect } from "vitest";
import { checkCompatibility } from "./compatibility.js";
import type { VersionRange } from "./types.js";

describe("checkCompatibility", () => {
  it("returns unknown when no range is provided", () => {
    const result = checkCompatibility("1.0.0");
    expect(result.status).toBe("unknown");
    expect(result.version).toBe("1.0.0");
    expect(result.notes).toEqual([]);
  });

  it("returns supported when version is within range", () => {
    const range: VersionRange = { minimum: "1.0.0", maximum: "3.0.0" };
    const result = checkCompatibility("2.0.0", range);
    expect(result.status).toBe("supported");
  });

  it("returns incompatible for blocked versions", () => {
    const range: VersionRange = { blocked: ["1.5.0", "2.0.0"] };
    const result = checkCompatibility("1.5.0", range);
    expect(result.status).toBe("incompatible");
    expect(result.reason).toContain("blocked");
  });

  it("returns incompatible when version is not in allowlist", () => {
    const range: VersionRange = { allowed: ["1.0.0", "2.0.0"] };
    const result = checkCompatibility("3.0.0", range);
    expect(result.status).toBe("incompatible");
    expect(result.reason).toContain("not in the allowed list");
  });

  it("returns supported when version is in allowlist", () => {
    const range: VersionRange = { allowed: ["1.0.0", "2.0.0"] };
    const result = checkCompatibility("2.0.0", range);
    expect(result.status).toBe("supported");
  });

  it("returns incompatible when version is below minimum", () => {
    const range: VersionRange = { minimum: "2.0.0" };
    const result = checkCompatibility("1.0.0", range);
    expect(result.status).toBe("incompatible");
    expect(result.reason).toContain("below minimum");
  });

  it("returns supported when version equals minimum", () => {
    const range: VersionRange = { minimum: "1.0.0" };
    const result = checkCompatibility("1.0.0", range);
    expect(result.status).toBe("supported");
  });

  it("returns incompatible when version is above maximum", () => {
    const range: VersionRange = { maximum: "2.0.0" };
    const result = checkCompatibility("3.0.0", range);
    expect(result.status).toBe("incompatible");
    expect(result.reason).toContain("above maximum");
  });

  it("returns supported when version equals maximum", () => {
    const range: VersionRange = { maximum: "2.0.0" };
    const result = checkCompatibility("2.0.0", range);
    expect(result.status).toBe("supported");
  });

  it("carries notes from the range", () => {
    const range: VersionRange = {
      minimum: "1.0.0",
      notes: ["Known issue with v1.2", "Requires migration"],
    };
    const result = checkCompatibility("1.5.0", range);
    expect(result.notes).toEqual(["Known issue with v1.2", "Requires migration"]);
  });

  it("returns empty notes when range has no notes", () => {
    const range: VersionRange = { minimum: "1.0.0" };
    const result = checkCompatibility("1.5.0", range);
    expect(result.notes).toEqual([]);
  });

  it("blocked takes precedence over allowed", () => {
    const range: VersionRange = {
      allowed: ["1.0.0", "1.5.0"],
      blocked: ["1.5.0"],
    };
    const result = checkCompatibility("1.5.0", range);
    expect(result.status).toBe("incompatible");
    expect(result.reason).toContain("blocked");
  });

  it("checks minimum and maximum together", () => {
    const range: VersionRange = { minimum: "1.0.0", maximum: "3.0.0" };
    expect(checkCompatibility("0.5.0", range).status).toBe("incompatible");
    expect(checkCompatibility("1.0.0", range).status).toBe("supported");
    expect(checkCompatibility("2.0.0", range).status).toBe("supported");
    expect(checkCompatibility("3.0.0", range).status).toBe("supported");
    expect(checkCompatibility("4.0.0", range).status).toBe("incompatible");
  });
});
