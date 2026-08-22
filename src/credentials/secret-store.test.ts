import { describe, it, expect } from "vitest";
import { InMemorySecretStore } from "./secret-store.js";

describe("InMemorySecretStore", () => {
  it("stores and retrieves a secret by ref", () => {
    const store = new InMemorySecretStore();
    store.set("ref://a", "s3cret");
    expect(store.has("ref://a")).toBe(true);
    expect(store.get("ref://a")).toBe("s3cret");
  });

  it("returns undefined for unknown refs", () => {
    const store = new InMemorySecretStore();
    expect(store.has("ref://missing")).toBe(false);
    expect(store.get("ref://missing")).toBeUndefined();
  });

  it("delete removes a stored secret", () => {
    const store = new InMemorySecretStore();
    store.set("ref://b", "material");
    expect(store.delete("ref://b")).toBe(true);
    expect(store.has("ref://b")).toBe(false);
    expect(store.delete("ref://b")).toBe(false);
  });

  it("rejects empty ref", () => {
    const store = new InMemorySecretStore();
    expect(() => store.set("", "material")).toThrow(/non-empty/);
  });

  it("rejects empty material", () => {
    const store = new InMemorySecretStore();
    expect(() => store.set("ref://x", "")).toThrow(/non-empty/);
  });

  it("raw secret never appears in JSON.stringify of the store", () => {
    const store = new InMemorySecretStore();
    store.set("ref://leak-test", "sk-live-SUPERSECRET");
    const json = JSON.stringify(store);
    expect(json).not.toContain("sk-live-SUPERSECRET");
  });
});
