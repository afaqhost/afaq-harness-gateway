import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

export function hashSecret(secret: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(secret, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6) return false;
    const [algo, nStr, rStr, pStr, saltHex, hashHex] = parts;
    if (algo !== "scrypt") return false;

    const N = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);
    const salt = Buffer.from(saltHex, "hex");
    const expectedHash = Buffer.from(hashHex, "hex");

    if (salt.length !== SALT_BYTES || expectedHash.length !== KEYLEN) return false;

    const actualHash = scryptSync(secret, salt, KEYLEN, { N, r, p });

    return timingSafeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}
