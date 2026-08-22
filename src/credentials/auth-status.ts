import type { CredentialProfile } from "../platform/entities.js";
import type { SecretStore } from "./secret-store.js";

export interface AuthenticationStatus {
  profileId: string;
  definitionId: string;
  authKind: CredentialProfile["authKind"];
  authenticated: boolean;
  checkedAt: string;
  reason?: string;
}

export function checkAuthenticationStatus(
  profile: CredentialProfile,
  store: SecretStore,
): AuthenticationStatus {
  const authenticated = store.has(profile.secretRef);
  return {
    profileId: profile.id,
    definitionId: profile.definitionId,
    authKind: profile.authKind,
    authenticated,
    checkedAt: new Date().toISOString(),
    ...(authenticated ? {} : { reason: "Credential material not found for profile." }),
  };
}
