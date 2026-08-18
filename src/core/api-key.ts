import { randomBytes } from "node:crypto";
import { hashSecret, verifySecret } from "./password.js";

const PREFIX = "ahg_live_";
const SECRET_BYTES = 24;

export function generateApiKey(): { fullKey: string; prefix: string } {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const fullKey = `${PREFIX}${secret}`;
  const prefix = `${PREFIX}${secret.slice(0, 8)}`;
  return { fullKey, prefix };
}

export function hashApiKey(fullKey: string): string {
  return hashSecret(fullKey);
}

export function verifyApiKey(fullKey: string, storedHash: string): boolean {
  return verifySecret(fullKey, storedHash);
}
