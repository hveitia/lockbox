import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  CURRENT_KDF_VERSION,
  LEGACY_KDF_VERSION,
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

  // Records which row of the scrypt parameter table built this vault's key.
  // NULL means "written before this column existed", which is version 1.
  addColumnIfMissing(db, "vault_meta", "kdf_version", "INTEGER");

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

type VaultMeta = { salt: string; verifier: string; kdfVersion: number };

function readMeta(db: DatabaseSync): VaultMeta | null {
  const row = db
    .prepare("SELECT salt, verifier, kdf_version FROM vault_meta WHERE id = 1")
    .get() as
    | { salt: string; verifier: string; kdf_version: number | null }
    | undefined;

  if (!row) return null;

  return {
    salt: row.salt,
    verifier: row.verifier,
    kdfVersion: row.kdf_version ?? LEGACY_KDF_VERSION,
  };
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

  db.prepare(
    "INSERT INTO vault_meta (id, salt, verifier, kdf_version) VALUES (1, ?, ?, ?)",
  ).run(salt.toString("base64"), createVerifier(key), CURRENT_KDF_VERSION);
}

/** Returns the vault key, or null when the vault is locked shut against this password. */
export function unlock(db: DatabaseSync, masterPassword: string): Buffer | null {
  const meta = readMeta(db);
  if (!meta) return null;

  // The version the vault recorded, never the current one: an old vault must
  // keep opening after the parameters move on.
  const key = deriveKey(
    masterPassword,
    Buffer.from(meta.salt, "base64"),
    meta.kdfVersion,
  );

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
 * Writes a self-contained copy of the vault to `destinationPath`.
 *
 * Copying `vault.db` with the filesystem does not work, and fails silently:
 * the vault runs in WAL mode, SQLite only folds the write-ahead log back into
 * the main file at 1000 pages or on a clean close, and a personal vault hits
 * neither — so the file sitting on disk is a stub whose tables have not been
 * written yet. `VACUUM INTO` builds a consistent single file from the database
 * plus its log, without pausing writers, and refuses to clobber an existing
 * path. The result needs no sidecar files and can be copied anywhere.
 */
export function backupVault(db: DatabaseSync, destinationPath: string): void {
  db.prepare("VACUUM INTO ?").run(destinationPath);
}

/**
 * Column names a table actually has, in declaration order.
 *
 * The schema goes before the pragma, not on the table: `PRAGMA x.table_info(t)`
 * is the form that reaches an attached database. `table_info(x.t)` is a syntax
 * error.
 */
function columnsOf(db: DatabaseSync, table: string, schema = "main"): string[] {
  return (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as unknown as {
    name: string;
  }[]).map((column) => column.name);
}

/**
 * Throws unless `candidatePath` is a readable SQLite file shaped like a vault.
 *
 * Restoring destroys what is already there, so a bad source has to be rejected
 * before anything is deleted rather than halfway through.
 */
export function assertRestorable(candidatePath: string): void {
  if (!existsSync(candidatePath)) {
    throw new Error(`There is no file at ${candidatePath}`);
  }

  let candidate: DatabaseSync;
  try {
    candidate = new DatabaseSync(candidatePath, { readOnly: true });
  } catch {
    throw new Error("That file is not a database");
  }

  try {
    // Reading the schema is what actually touches the file; opening is lazy,
    // so a text file with a .db suffix only fails here.
    let tables: string[];
    try {
      tables = (candidate
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as unknown as { name: string }[]).map((row) => row.name);
    } catch {
      throw new Error("That file is not a database");
    }

    for (const required of ["vault_meta", "entries"]) {
      if (!tables.includes(required)) {
        throw new Error("That file is not a vault backup");
      }
    }

    const meta = candidate.prepare("SELECT count(*) AS n FROM vault_meta").get() as {
      n: number;
    };

    if (meta.n !== 1) {
      throw new Error("That backup has no master password recorded");
    }
  } finally {
    candidate.close();
  }
}

/**
 * Replaces the contents of `db` with those of the vault at `backupPath`.
 *
 * Deliberately not a file copy. Overwriting vault.db from outside is a silent
 * corruption trap: any process still holding the vault open checkpoints its
 * write-ahead log over the restored file afterwards, so the discarded rows come
 * back with no error shown. Doing it as SQL inside one transaction sidesteps
 * that entirely — SQLite's own locking handles other readers, and a failure
 * rolls back to the vault as it was.
 *
 * The backup's `vault_meta` comes across too, so the vault ends up on whatever
 * master password the backup was taken under. Callers must drop any key they
 * are holding afterwards; it no longer opens anything.
 */
export function restoreVault(db: DatabaseSync, backupPath: string): void {
  assertRestorable(backupPath);

  db.prepare("ATTACH DATABASE ? AS restore_source").run(backupPath);
  try {
    // A backup taken before url/favorite/color existed simply has fewer
    // columns; the missing ones stay NULL, which readEntry already treats as
    // "written before this existed".
    const inBackup = columnsOf(db, "entries", "restore_source");
    const shared = columnsOf(db, "entries").filter((c) => inBackup.includes(c));
    const columnList = shared.join(", ");

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM entries");
      db.exec("DELETE FROM vault_meta");
      // Carried across like any other column. A backup taken before
      // kdf_version existed simply does not have it, and the NULL that leaves
      // behind decodes to version 1 — which is what such a backup was built
      // with. Losing this would make a restored vault unopenable.
      const inBackupMeta = columnsOf(db, "vault_meta", "restore_source");
      const metaColumns = columnsOf(db, "vault_meta")
        .filter((c) => inBackupMeta.includes(c))
        .join(", ");

      db.exec(
        `INSERT INTO vault_meta (${metaColumns})
         SELECT ${metaColumns} FROM restore_source.vault_meta`,
      );
      db.exec(
        `INSERT INTO entries (${columnList})
         SELECT ${columnList} FROM restore_source.entries`,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.exec("DETACH DATABASE restore_source");
  }
}

/**
 * Backs the vault up into `directory` under a timestamped name, creating the
 * directory if needed, and returns the path written.
 *
 * `now` is injectable so the name is testable; nothing else should pass it.
 */
export function createBackup(
  db: DatabaseSync,
  directory: string,
  now: Date = new Date(),
): string {
  mkdirSync(directory, { recursive: true });

  // Colons are legal on macOS and Linux but not on every filesystem a backup
  // may be copied to, and Finder renders them as slashes. Milliseconds stay
  // in: backupVault refuses to overwrite, so two backups in the same second
  // must not collide.
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  const destination = path.join(directory, `vault-${stamp}.db`);

  backupVault(db, destination);

  return destination;
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
    // Re-stamped with the current version, not the one the vault had. This is
    // also the upgrade path: re-encrypting under a new key is exactly what
    // moving to stronger parameters requires, so it comes for free here.
    db.prepare(
      "UPDATE vault_meta SET salt = ?, verifier = ?, kdf_version = ? WHERE id = 1",
    ).run(salt.toString("base64"), createVerifier(newKey), CURRENT_KDF_VERSION);

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
