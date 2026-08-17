import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { decrypt, deriveKey, verifyKey } from "./crypto.ts";
import { listEntries, unlock } from "./vault.ts";

/**
 * The other half of the interop contract.
 *
 * desktop_app/test/vault_crypto_test.dart proves Dart can read what Node
 * writes. This proves Node can read what Dart writes — which is what makes it
 * safe for the desktop app to edit the same vault the web app serves.
 *
 * Regenerate the fixture after touching either crypto implementation:
 *   cd desktop_app && dart run tool/emit_dart_vectors.dart
 */
const FIXTURE = path.join(import.meta.dirname, "fixtures", "dart_vectors.json");

describe("Dart interop", () => {
  if (!existsSync(FIXTURE)) {
    test("fixture is present", () => {
      assert.fail(
        `Missing ${FIXTURE}. Regenerate with:\n` +
          "  cd desktop_app && dart run tool/emit_dart_vectors.dart",
      );
    });

    return;
  }

  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const salt = Buffer.from(fixture.saltHex, "hex");
  const key = deriveKey(fixture.password, salt);

  test("both languages derive the same key from the same inputs", () => {
    assert.equal(key.toString("hex"), fixture.derivedKeyHex);
  });

  test("accepts a verifier token written by Dart", () => {
    assert.equal(verifyKey(key, fixture.verifierBase64), true);
  });

  test("rejects that verifier under a different key", () => {
    assert.equal(verifyKey(deriveKey("wrong password", salt), fixture.verifierBase64), false);
  });

  for (const vector of fixture.vectors) {
    const label =
      vector.plaintext === ""
        ? "(empty string)"
        : vector.plaintext.length > 24
          ? `${vector.plaintext.slice(0, 24)}…`
          : vector.plaintext;

    test(`reads what Dart encrypted: ${label}`, () => {
      assert.equal(decrypt(vector.payloadBase64, key), vector.plaintext);
    });
  }
});

/**
 * The step the desktop app's CRUD depends on: a vault the Dart implementation
 * created and wrote rows into must open and read cleanly here.
 *
 * Regenerate with:
 *   cd desktop_app && dart run tool/write_interop_entry.dart
 */
const DART_VAULT = path.join(import.meta.dirname, "fixtures", "dart_written_vault.db");

describe("a vault written by Dart", () => {
  if (!existsSync(DART_VAULT)) {
    test("fixture is present", () => {
      assert.fail(
        `Missing ${DART_VAULT}. Regenerate with:\n` +
          "  cd desktop_app && dart run tool/write_interop_entry.dart",
      );
    });

    return;
  }

  const db = new DatabaseSync(DART_VAULT, { readOnly: true });
  const key = unlock(db, "dart-written-master");

  test("opens with the master password Dart set", () => {
    assert.ok(key, "the Dart-created vault did not unlock");
  });

  test("decrypts every field Dart wrote", () => {
    const entry = listEntries(db, key!).find((e) => e.app === "Written by Dart");

    assert.ok(entry, "entry written by Dart is missing");
    assert.equal(entry.username, "desktop@example.dev");
    assert.equal(entry.url, "https://desktop.example.dev/panel");
    assert.equal(entry.password, "dart-side-secret");
    assert.equal(entry.comment, "multi\nline — ñ ü 🔐");
    assert.equal(entry.favorite, true);
    assert.equal(entry.color, "orchid");
  });

  test("preserves significant whitespace in a password", () => {
    const entry = listEntries(db, key!).find((e) => e.app === "Second from Dart");

    assert.equal(entry?.password, "  padded  ");
  });

  test("applies the same favorites-first ordering", () => {
    assert.deepEqual(
      listEntries(db, key!).map((e) => e.app),
      ["Written by Dart", "Second from Dart"],
    );
  });
});
