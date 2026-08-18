import { describe, it, expect } from "vitest";
import { hashSecret, verifySecret } from "./password.js";

describe("password hashing", () => {
  it("round-trips a secret through hash and verify", () => {
    const secret = "my-super-secret-value";
    const stored = hashSecret(secret);
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(verifySecret(secret, stored)).toBe(true);
  });

  it("returns false for a wrong secret", () => {
    const stored = hashSecret("correct-password");
    expect(verifySecret("wrong-password", stored)).toBe(false);
  });

  it("returns false for a malformed stored string", () => {
    expect(verifySecret("anything", "")).toBe(false);
    expect(verifySecret("anything", "not-a-hash")).toBe(false);
    expect(verifySecret("anything", "scrypt$16384$8$1$abc$def")).toBe(false);
  });
});
