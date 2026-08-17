import type { DatabaseSync } from "node:sqlite";

import {
  createSalt,
  createVerifier,
  decrypt,
  deriveKey,
  encrypt,
  verifyKey,
} from "./crypto.ts";

import {
  MIN_MASTER_PASSWORD_LENGTH,
  normalizeColor,
  normalizeUrl,
  readColor,
  type Entry,
  type EntryInput,
} from "./entry.ts";

export { MIN_MASTER_PASSWORD_LENGTH };
export type { Entry, EntryInput };

/** Null on rows written before the column existed. */
type EntryRow = {
  id: number;
  app: string;
  username: string;
  url: string | null;
  password: string;
  comment: string;
  favorite: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
};

/** Creates the schema. Safe to call on every startup. */
export function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS vault_meta (
      id       INTEGER PRIMARY KEY CHECK (id = 1),
      salt     TEXT NOT NULL,
      verifier TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      app        TEXT NOT NULL,
      username   TEXT NOT NULL,
      password   TEXT NOT NULL,
      comment    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  addColumnIfMissing(db, "entries", "url", "TEXT");
  addColumnIfMissing(db, "entries", "favorite", "TEXT");
  addColumnIfMissing(db, "entries", "color", "TEXT");
}

/**
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so check the table first.
 * New columns must be nullable: existing rows hold ciphertext, and there is no
 * key available at migration time to encrypt a default value with.
 */
function addColumnIfMissing(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
    name: string;
  }[];

  if (columns.some((c) => c.name === column)) return;

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function readMeta(db: DatabaseSync): { salt: string; verifier: string } | null {
  const row = db.prepare("SELECT salt, verifier FROM vault_meta WHERE id = 1").get();

  return (row as { salt: string; verifier: string } | undefined) ?? null;
}

export function isInitialized(db: DatabaseSync): boolean {
  return readMeta(db) !== null;
}

function assertMasterPasswordStrength(masterPassword: string): void {
  if (masterPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
    throw new Error(
      `Master password must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters`,
    );
  }
}

/** Sets the master password for a brand new vault. */
export function initializeVault(db: DatabaseSync, masterPassword: string): void {
  if (isInitialized(db)) {
    throw new Error("Vault is already initialized");
  }
  assertMasterPasswordStrength(masterPassword);

  const salt = createSalt();
  const key = deriveKey(masterPassword, salt);

  db.prepare("INSERT INTO vault_meta (id, salt, verifier) VALUES (1, ?, ?)").run(
    salt.toString("base64"),
    createVerifier(key),
  );
}

/** Returns the vault key, or null when the vault is locked shut against this password. */
export function unlock(db: DatabaseSync, masterPassword: string): Buffer | null {
  const meta = readMeta(db);
  if (!meta) return null;

  const key = deriveKey(masterPassword, Buffer.from(meta.salt, "base64"));

  return verifyKey(key, meta.verifier) ? key : null;
}

/** Reads a column added after the fact; NULL means "written before it existed". */
function decryptAdded(value: string | null, key: Buffer): string {
  return value === null ? "" : decrypt(value, key);
}

function decryptRow(row: EntryRow, key: Buffer): Entry {
  return {
    id: row.id,
    app: decrypt(row.app, key),
    username: decrypt(row.username, key),
    url: decryptAdded(row.url, key),
    password: decrypt(row.password, key),
    comment: decrypt(row.comment, key),
    favorite: decryptAdded(row.favorite, key) === "true",
    color: readColor(decryptAdded(row.color, key)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Every field is encrypted, so sorting and searching cannot happen in SQL.
 * That is fine at the scale this vault is built for (a personal list of apps).
 */
export function listEntries(db: DatabaseSync, key: Buffer): Entry[] {
  const rows = db.prepare("SELECT * FROM entries").all() as unknown as EntryRow[];

  return rows
    .map((row) => decryptRow(row, key))
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;

      return a.app.localeCompare(b.app, undefined, { sensitivity: "base" });
    });
}

function normalize(input: EntryInput): EntryInput {
  const normalized = {
    app: input.app.trim(),
    username: input.username.trim(),
    url: normalizeUrl(input.url),
    // Passwords are stored verbatim: leading/trailing spaces can be significant.
    password: input.password,
    comment: input.comment.trim(),
    favorite: input.favorite,
    color: normalizeColor(input.color),
  };

  if (!normalized.app) throw new Error("App is required");
  if (!normalized.password) throw new Error("Password is required");

  return normalized;
}

export function createEntry(db: DatabaseSync, key: Buffer, input: EntryInput): Entry {
  const entry = normalize(input);
  const now = new Date().toISOString();

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO entries
         (app, username, url, password, comment, favorite, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      encrypt(entry.app, key),
      encrypt(entry.username, key),
      encrypt(entry.url, key),
      encrypt(entry.password, key),
      encrypt(entry.comment, key),
      encrypt(String(entry.favorite), key),
      encrypt(entry.color, key),
      now,
      now,
    );

  return { ...entry, id: Number(lastInsertRowid), createdAt: now, updatedAt: now };
}

export function updateEntry(
  db: DatabaseSync,
  key: Buffer,
  id: number,
  input: EntryInput,
): Entry {
  const entry = normalize(input);
  const existing = db
    .prepare("SELECT created_at FROM entries WHERE id = ?")
    .get(id) as { created_at: string } | undefined;

  if (!existing) {
    throw new Error(`No entry with id ${id}`);
  }

  const now = new Date().toISOString();

  db.prepare(
    `UPDATE entries
        SET app = ?, username = ?, url = ?, password = ?, comment = ?,
            favorite = ?, color = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    encrypt(entry.app, key),
    encrypt(entry.username, key),
    encrypt(entry.url, key),
    encrypt(entry.password, key),
    encrypt(entry.comment, key),
    encrypt(String(entry.favorite), key),
    encrypt(entry.color, key),
    now,
    id,
  );

  return { ...entry, id, createdAt: existing.created_at, updatedAt: now };
}

/** Flips just the favorite flag, so the one-click star never rewrites a password. */
export function setFavorite(
  db: DatabaseSync,
  key: Buffer,
  id: number,
  favorite: boolean,
): void {
  const { changes } = db
    .prepare("UPDATE entries SET favorite = ?, updated_at = ? WHERE id = ?")
    .run(encrypt(String(favorite), key), new Date().toISOString(), id);

  if (changes === 0) {
    throw new Error(`No entry with id ${id}`);
  }
}

export function deleteEntry(db: DatabaseSync, id: number): void {
  const { changes } = db.prepare("DELETE FROM entries WHERE id = ?").run(id);

  if (changes === 0) {
    throw new Error(`No entry with id ${id}`);
  }
}

/**
 * Re-encrypts every entry under a key derived from `newMasterPassword`.
 * Runs in a transaction so a failure leaves the old password working.
 */
export function changeMasterPassword(
  db: DatabaseSync,
  currentKey: Buffer,
  newMasterPassword: string,
): Buffer {
  assertMasterPasswordStrength(newMasterPassword);

  const entries = listEntries(db, currentKey);
  const salt = createSalt();
  const newKey = deriveKey(newMasterPassword, salt);

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE vault_meta SET salt = ?, verifier = ? WHERE id = 1").run(
      salt.toString("base64"),
      createVerifier(newKey),
    );

    const update = db.prepare(
      `UPDATE entries
          SET app = ?, username = ?, url = ?, password = ?, comment = ?,
              favorite = ?, color = ?
        WHERE id = ?`,
    );

    for (const entry of entries) {
      update.run(
        encrypt(entry.app, newKey),
        encrypt(entry.username, newKey),
        encrypt(entry.url, newKey),
        encrypt(entry.password, newKey),
        encrypt(entry.comment, newKey),
        encrypt(String(entry.favorite), newKey),
        encrypt(entry.color, newKey),
        entry.id,
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return newKey;
}
