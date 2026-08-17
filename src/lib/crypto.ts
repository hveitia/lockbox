import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * scrypt cost parameters. N=2^15 keeps unlocking around ~100ms on a laptop
 * while making offline brute force of the vault file expensive.
 */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

/** Constant plaintext used to prove a derived key matches the vault. */
const VERIFIER_PLAINTEXT = "vault-key-verifier-v1";

export function createSalt(): Buffer {
  return randomBytes(SALT_BYTES);
}

/** Derives the vault key from the master password. Intentionally slow. */
export function deriveKey(masterPassword: string, salt: Buffer): Buffer {
  return scryptSync(masterPassword.normalize("NFKC"), salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

/** Encrypts to a base64 payload laid out as iv | authTag | ciphertext. */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** Decrypts a payload produced by `encrypt`. Throws if the key is wrong or the data was tampered with. */
export function decrypt(payload: string, key: Buffer): string {
  const raw = Buffer.from(payload, "base64");

  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Ciphertext is too short to be valid");
  }

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

/** Builds the token stored in the vault so a master password can be checked. */
export function createVerifier(key: Buffer): string {
  return encrypt(VERIFIER_PLAINTEXT, key);
}

/** Returns true when `key` is the key the verifier was created with. */
export function verifyKey(key: Buffer, verifier: string): boolean {
  try {
    const decrypted = Buffer.from(decrypt(verifier, key), "utf8");
    const expected = Buffer.from(VERIFIER_PLAINTEXT, "utf8");

    return (
      decrypted.length === expected.length && timingSafeEqual(decrypted, expected)
    );
  } catch {
    return false;
  }
}
