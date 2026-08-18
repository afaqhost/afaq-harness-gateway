import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, verifyApiKey } from "./api-key.js";

describe("API key generation and verification", () => {
  it("produces the expected fullKey and prefix format", () => {
    const { fullKey, prefix } = generateApiKey();
    expect(fullKey).toMatch(/^ahg_live_[A-Za-z0-9_-]{32}$/);
    expect(prefix).toMatch(/^ahg_live_[A-Za-z0-9_-]{8}$/);
    expect(fullKey.startsWith(prefix)).toBe(true);
  });

  it("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().fullKey));
    expect(keys.size).toBe(50);
  });

  it("hashes and verifies a key correctly", () => {
    const { fullKey } = generateApiKey();
    const hash = hashApiKey(fullKey);
    expect(hash).toMatch(/^scrypt\$/);
    expect(verifyApiKey(fullKey, hash)).toBe(true);
  });

  it("rejects a wrong key against a stored hash", () => {
    const { fullKey } = generateApiKey();
    const hash = hashApiKey(fullKey);
    expect(verifyApiKey("ahg_live_wrongkey123", hash)).toBe(false);
  });
});
