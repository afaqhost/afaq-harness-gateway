import { describe, it, expect } from "vitest";
import { checkAuthenticationStatus } from "./auth-status.js";
import { InMemorySecretStore } from "./secret-store.js";
import { createCredentialProfile } from "../platform/entities.js";

describe("checkAuthenticationStatus", () => {
  it("returns authenticated true when secret exists in store", () => {
    const store = new InMemorySecretStore();
    const profile = createCredentialProfile({
      id: "cp1",
      name: "Key A",
      definitionId: "d1",
      secretRef: "ref://vault/cp1",
    });
    store.set("ref://vault/cp1", "actual-secret");

    const status = checkAuthenticationStatus(profile, store);
    expect(status.authenticated).toBe(true);
    expect(status.profileId).toBe("cp1");
    expect(status.definitionId).toBe("d1");
    expect(status.reason).toBeUndefined();
  });

  it("returns authenticated false with reason when secret is missing", () => {
    const store = new InMemorySecretStore();
    const profile = createCredentialProfile({
      id: "cp2",
      name: "Key B",
      definitionId: "d1",
      secretRef: "ref://vault/cp2",
    });

    const status = checkAuthenticationStatus(profile, store);
    expect(status.authenticated).toBe(false);
    expect(status.reason).toBe("Credential material not found for profile.");
  });

  it("checkedAt is a valid ISO timestamp", () => {
    const store = new InMemorySecretStore();
    const profile = createCredentialProfile({
      id: "cp3",
      name: "Key C",
      definitionId: "d1",
      secretRef: "ref://vault/cp3",
    });

    const status = checkAuthenticationStatus(profile, store);
    expect(() => new Date(status.checkedAt)).not.toThrow();
    expect(new Date(status.checkedAt).toISOString()).toBe(status.checkedAt);
  });

  it("raw secret never appears in JSON.stringify of the status", () => {
    const store = new InMemorySecretStore();
    const profile = createCredentialProfile({
      id: "cp4",
      name: "Key D",
      definitionId: "d1",
      secretRef: "ref://vault/cp4",
    });
    store.set("ref://vault/cp4", "sk-live-NEVERLEAK");

    const status = checkAuthenticationStatus(profile, store);
    const json = JSON.stringify(status);
    expect(json).not.toContain("sk-live-NEVERLEAK");
    expect(json).not.toContain("ref://vault/cp4");
  });

  it("status includes authKind from profile", () => {
    const store = new InMemorySecretStore();
    const profile = createCredentialProfile({
      id: "cp5",
      name: "Key E",
      definitionId: "d1",
      secretRef: "ref://vault/cp5",
      authKind: "api_key_ref",
    });

    const status = checkAuthenticationStatus(profile, store);
    expect(status.authKind).toBe("api_key_ref");
  });
});
