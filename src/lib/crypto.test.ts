import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createSalt,
  deriveKey,
  encrypt,
  decrypt,
  createVerifier,
  verifyKey,
} from "./crypto.ts";

describe("createSalt", () => {
  test("returns 16 random bytes", () => {
    const a = createSalt();
    const b = createSalt();

    assert.equal(a.length, 16);
    assert.notEqual(a.toString("hex"), b.toString("hex"));
  });
});

describe("deriveKey", () => {
  test("returns a 32 byte key", () => {
    const key = deriveKey("correct horse battery staple", createSalt());

    assert.equal(key.length, 32);
  });

  test("is deterministic for the same password and salt", () => {
    const salt = createSalt();

    assert.deepEqual(deriveKey("hunter2", salt), deriveKey("hunter2", salt));
  });

  test("differs when the password differs", () => {
    const salt = createSalt();

    assert.notDeepEqual(deriveKey("hunter2", salt), deriveKey("hunter3", salt));
  });

  test("differs when the salt differs", () => {
    assert.notDeepEqual(
      deriveKey("hunter2", createSalt()),
      deriveKey("hunter2", createSalt()),
    );
  });
});

describe("encrypt / decrypt", () => {
  const key = deriveKey("master", createSalt());

  test("round trips a plain string", () => {
    assert.equal(decrypt(encrypt("s3cret", key), key), "s3cret");
  });

  test("round trips an empty string", () => {
    assert.equal(decrypt(encrypt("", key), key), "");
  });

  test("round trips unicode and multi line text", () => {
    const text = "línea uno\nlínea dos — ñ ü 🔐";

    assert.equal(decrypt(encrypt(text, key), key), text);
  });

  test("produces a different ciphertext each time (random iv)", () => {
    assert.notEqual(encrypt("s3cret", key), encrypt("s3cret", key));
  });

  test("does not leak the plaintext into the ciphertext", () => {
    assert.ok(!encrypt("s3cret", key).includes("s3cret"));
  });

  test("throws when decrypting with the wrong key", () => {
    const other = deriveKey("not the master", createSalt());

    assert.throws(() => decrypt(encrypt("s3cret", key), other));
  });

  test("throws when the ciphertext was tampered with", () => {
    const payload = Buffer.from(encrypt("s3cret", key), "base64");
    payload[payload.length - 1] ^= 0xff;

    assert.throws(() => decrypt(payload.toString("base64"), key));
  });

  test("throws when the payload is too short to hold iv and tag", () => {
    assert.throws(() => decrypt(Buffer.alloc(4).toString("base64"), key));
  });
});

describe("createVerifier / verifyKey", () => {
  test("accepts the key that created it", () => {
    const salt = createSalt();
    const key = deriveKey("master", salt);

    assert.equal(verifyKey(key, createVerifier(key)), true);
  });

  test("rejects a key derived from another password", () => {
    const salt = createSalt();
    const verifier = createVerifier(deriveKey("master", salt));

    assert.equal(verifyKey(deriveKey("wrong", salt), verifier), false);
  });

  test("rejects a malformed verifier instead of throwing", () => {
    assert.equal(verifyKey(deriveKey("master", createSalt()), "not-base64!"), false);
  });
});
