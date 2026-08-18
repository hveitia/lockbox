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
 * scrypt cost parameters, by version.
 *
 * The salt is stored in the vault but these are not, which is the whole reason
 * this table is versioned: a key cannot be reproduced without both, so a vault
 * has to record which row it was built with. Change these numbers without
 * recording a version and every existing vault stops opening, indistinguishably
 * from a wrong password.
 *
 * Never edit an existing row — a vault out there was written with it. Add a
 * row and move `CURRENT_KDF_VERSION`.
 *
 * 1: ~44ms to derive on a 2026 laptop, 32MB.
 * 2: ~183ms, 128MB. OWASP's current floor for scrypt.
 */
const KDF_PARAMETERS = {
  1: { N: 32768, r: 8, p: 1 },
  2: { N: 131072, r: 8, p: 1 },
} as const;

export type KdfVersion = keyof typeof KDF_PARAMETERS;

/** What new vaults are written with. */
export const CURRENT_KDF_VERSION: KdfVersion = 1;

/**
 * What a missing `kdf_version` means.
 *
 * Vaults written before the column existed have NULL there. They were all
 * built with version 1, so that is what NULL decodes to — this must never
 * change.
 */
export const LEGACY_KDF_VERSION: KdfVersion = 1;

export function kdfParameters(version: number) {
  const parameters = KDF_PARAMETERS[version as KdfVersion];

  if (!parameters) {
    throw new Error(
      `This vault was written with key derivation version ${version}, which ` +
        `this build does not know about. Use a newer version of the app.`,
    );
  }

  return parameters;
}

/** Constant plaintext used to prove a derived key matches the vault. */
const VERIFIER_PLAINTEXT = "vault-key-verifier-v1";

export function createSalt(): Buffer {
  return randomBytes(SALT_BYTES);
}

/**
 * Derives the vault key from the master password. Intentionally slow.
 *
 * `version` selects the cost parameters and defaults to what new vaults use.
 * Callers opening an existing vault must pass the version recorded in it, not
 * the default — that is the entire point of recording it.
 */
export function deriveKey(
  masterPassword: string,
  salt: Buffer,
  version: number = CURRENT_KDF_VERSION,
): Buffer {
  const { N, r, p } = kdfParameters(version);

  return scryptSync(masterPassword.normalize("NFKC"), salt, KEY_BYTES, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
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
