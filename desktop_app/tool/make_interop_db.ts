/**
 * Builds a vault with the Node implementation for the Dart tests to open.
 * Proves the desktop app can read a real database the web app produced —
 * schema, migration state and ciphertext included.
 *
 * Run from the repo root:  node desktop_app/tool/make_interop_db.ts <path>
 */
import { rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { migrate, initializeVault, unlock, createEntry } from "../../src/lib/vault.ts";

const target = process.argv[2];
if (!target) {
  console.error("usage: node make_interop_db.ts <path-to-db>");
  process.exit(1);
}

for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(target + suffix, { force: true });
}
mkdirSync(path.dirname(target), { recursive: true });

const db = new DatabaseSync(target);
migrate(db);
initializeVault(db, "interop-master-password");

const key = unlock(db, "interop-master-password")!;

createEntry(db, key, {
  app: "Node written entry",
  username: "admin@example.dev",
  url: "https://acme.dev/admin",
  password: "s3cret from node",
  comment: "line one\nline two — ñ 🔐",
  favorite: true,
  color: "teal",
});

createEntry(db, key, {
  app: "Plain one",
  username: "",
  url: "",
  password: "  spaces matter  ",
  comment: "",
  favorite: false,
  color: "default",
});

// A row shaped like one written before url/favorite/color existed.
const legacy = createEntry(db, key, {
  app: "Legacy row",
  username: "old",
  url: "",
  password: "old-pw",
  comment: "",
  favorite: false,
  color: "default",
});
db.prepare(
  "UPDATE entries SET url = NULL, favorite = NULL, color = NULL WHERE id = ?",
).run(legacy.id);

db.close();

console.log(`built interop vault at ${target}`);
