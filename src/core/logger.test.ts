import { describe, it, expect } from "vitest";
import { redactSecrets } from "./logger.js";

describe("redactSecrets", () => {
  it("redacts Bearer tokens", () => {
    expect(redactSecrets("Authorization: Bearer ahg_live_abc123")).not.toContain("ahg_live_abc123");
    expect(redactSecrets("Authorization: Bearer ahg_live_abc123")).toContain("[REDACTED]");
  });

  it("redacts raw api keys", () => {
    expect(redactSecrets("api key: ahg_live_secret")).not.toContain("ahg_live_secret");
  });

  it("redacts password assignments", () => {
    expect(redactSecrets("password=supersecret")).not.toContain("supersecret");
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("run completed")).toBe("run completed");
  });
});
