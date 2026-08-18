import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  migrate,
  isInitialized,
  initializeVault,
  unlock,
  listEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  setFavorite,
  changeMasterPassword,
  backupVault,
  createBackup,
  restoreVault,
  assertRestorable,
} from "./vault.ts";
import {
  CURRENT_KDF_VERSION,
  createSalt,
  createVerifier,
  deriveKey,
  encrypt as encryptWith,
} from "./crypto.ts";
import type { EntryInput } from "./entry.ts";

const MASTER = "a-strong-master-password";

function input(overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    app: "App",
    username: "u",
    url: "",
    password: "p",
    comment: "",
    favorite: false,
    color: "default",
    ...overrides,
  };
}

function freshDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

describe("initializeVault", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = freshDatabase();
  });

  test("reports an empty vault as not initialized", () => {
    assert.equal(isInitialized(db), false);
  });

  test("reports an initialized vault as initialized", () => {
    initializeVault(db, MASTER);

    assert.equal(isInitialized(db), true);
  });

  test("rejects initializing twice", () => {
    initializeVault(db, MASTER);

    assert.throws(() => initializeVault(db, "another"));
  });

  test("rejects a master password shorter than 8 characters", () => {
    assert.throws(() => initializeVault(db, "short"));
  });
});

describe("migrate", () => {
  test("is safe to run repeatedly", () => {
    const db = freshDatabase();

    assert.doesNotThrow(() => {
      migrate(db);
      migrate(db);
    });
  });

  test("adds the url column to a database created before it existed", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE vault_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, verifier TEXT NOT NULL
      );
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app TEXT NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL,
        comment TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);

    migrate(db);

    const columns = (db.prepare("PRAGMA table_info(entries)").all() as unknown as {
      name: string;
    }[]).map((c) => c.name);

    for (const added of ["url", "favorite", "color"]) {
      assert.ok(columns.includes(added), `${added} column missing`);
    }
  });

  test("reads pre-existing rows back with an empty url", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE vault_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, verifier TEXT NOT NULL
      );
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app TEXT NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL,
        comment TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    migrate(db);
    initializeVault(db, MASTER);
    const key = unlock(db, MASTER)!;

    // Simulate a row written before the columns existed: they stay NULL.
    const created = createEntry(db, key, input({ app: "Legacy" }));
    db.prepare(
      "UPDATE entries SET url = NULL, favorite = NULL, color = NULL WHERE id = ?",
    ).run(created.id);

    const [legacy] = listEntries(db, key);
    assert.equal(legacy.url, "");
    assert.equal(legacy.favorite, false);
    assert.equal(legacy.color, "default");
  });
});

describe("unlock", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = freshDatabase();
    initializeVault(db, MASTER);
  });

  test("returns a key for the right master password", () => {
    assert.ok(unlock(db, MASTER));
  });

  test("returns null for the wrong master password", () => {
    assert.equal(unlock(db, "wrong-password"), null);
  });

  test("returns null when the vault was never initialized", () => {
    assert.equal(unlock(freshDatabase(), MASTER), null);
  });
});

describe("entries", () => {
  let db: DatabaseSync;
  let key: Buffer;

  beforeEach(() => {
    db = freshDatabase();
    initializeVault(db, MASTER);
    key = unlock(db, MASTER)!;
  });

  test("starts empty", () => {
    assert.deepEqual(listEntries(db, key), []);
  });

  test("creates and reads back an entry", () => {
    const created = createEntry(
      db,
      key,
      input({
        app: "My Dashboard",
        username: "admin",
        url: "https://acme.dev/admin",
        password: "s3cret",
        comment: "staging only",
      }),
    );

    assert.deepEqual(listEntries(db, key), [created]);
    assert.equal(created.app, "My Dashboard");
    assert.equal(created.url, "https://acme.dev/admin");
    assert.equal(created.password, "s3cret");
    assert.equal(created.comment, "staging only");
  });

  test("stores every field encrypted at rest", () => {
    createEntry(
      db,
      key,
      input({
        app: "My Dashboard",
        username: "admin",
        url: "https://acme.dev/admin",
        password: "s3cret",
        comment: "staging only",
      }),
    );

    const row = db.prepare("SELECT * FROM entries").get() as Record<string, string>;
    const stored = Object.values(row).join("|");

    for (const secret of [
      "My Dashboard",
      "admin",
      "acme.dev",
      "s3cret",
      "staging only",
    ]) {
      assert.ok(!stored.includes(secret), `${secret} leaked in plaintext`);
    }
  });

  test("accepts an empty comment and an empty url", () => {
    const created = createEntry(db, key, input({ comment: "", url: "" }));

    assert.equal(created.comment, "");
    assert.equal(created.url, "");
  });

  test("normalizes a bare host into an https url", () => {
    const created = createEntry(db, key, input({ url: "acme.dev/admin" }));

    assert.equal(created.url, "https://acme.dev/admin");
  });

  test("rejects a url with a scripting scheme", () => {
    assert.throws(() => createEntry(db, key, input({ url: "javascript:alert(1)" })));
  });

  test("rejects an entry with a blank app", () => {
    assert.throws(() => createEntry(db, key, input({ app: "   " })));
  });

  test("rejects an entry with a blank password", () => {
    assert.throws(() => createEntry(db, key, input({ password: "" })));
  });

  test("trims surrounding whitespace on app and username", () => {
    const created = createEntry(
      db,
      key,
      input({
        app: "  App  ",
        username: "  user  ",
        password: "  pw  ",
        comment: "  note  ",
      }),
    );

    assert.equal(created.app, "App");
    assert.equal(created.username, "user");
    assert.equal(created.password, "  pw  ", "password whitespace is significant");
    assert.equal(created.comment, "note");
  });

  test("sorts entries by app name, case insensitively", () => {
    for (const app of ["zeta", "Alpha", "middle"]) {
      createEntry(db, key, input({ app }));
    }

    assert.deepEqual(
      listEntries(db, key).map((e) => e.app),
      ["Alpha", "middle", "zeta"],
    );
  });

  test("lists favorites first, each group still alphabetical", () => {
    createEntry(db, key, input({ app: "Alpha" }));
    createEntry(db, key, input({ app: "Zeta", favorite: true }));
    createEntry(db, key, input({ app: "Beta" }));
    createEntry(db, key, input({ app: "Mid", favorite: true }));

    assert.deepEqual(
      listEntries(db, key).map((e) => e.app),
      ["Mid", "Zeta", "Alpha", "Beta"],
    );
  });

  test("defaults a new entry to not favorite and the default color", () => {
    const created = createEntry(db, key, input());

    assert.equal(created.favorite, false);
    assert.equal(created.color, "default");
  });

  test("round trips favorite and color", () => {
    const created = createEntry(db, key, input({ favorite: true, color: "teal" }));

    const [stored] = listEntries(db, key);
    assert.equal(stored.favorite, true);
    assert.equal(stored.color, "teal");
    assert.deepEqual(stored, created);
  });

  test("stores favorite and color encrypted at rest", () => {
    createEntry(db, key, input({ favorite: true, color: "indigo" }));

    const row = db.prepare("SELECT * FROM entries").get() as Record<string, unknown>;
    const stored = Object.values(row).join("|");

    assert.ok(!stored.includes("indigo"), "color leaked in plaintext");
    assert.ok(!stored.includes("true"), "favorite leaked in plaintext");
  });

  test("rejects a color that is not on the list", () => {
    assert.throws(() =>
      createEntry(db, key, input({ color: "hotpink" as EntryInput["color"] })),
    );
  });

  test("toggles favorite through an update", () => {
    const created = createEntry(db, key, input({ favorite: true, color: "moss" }));

    const updated = updateEntry(
      db,
      key,
      created.id,
      input({ favorite: false, color: "moss" }),
    );

    assert.equal(updated.favorite, false);
    assert.equal(listEntries(db, key)[0].favorite, false);
  });

  test("updates an existing entry", () => {
    const created = createEntry(db, key, input());

    const updated = updateEntry(
      db,
      key,
      created.id,
      input({
        app: "App renamed",
        username: "u2",
        url: "https://renamed.dev",
        password: "p2",
        comment: "now with a note",
      }),
    );

    assert.equal(updated.id, created.id);
    assert.equal(updated.url, "https://renamed.dev");
    assert.equal(updated.createdAt, created.createdAt);
    assert.deepEqual(listEntries(db, key), [updated]);
  });

  test("throws when updating an unknown id", () => {
    assert.throws(() => updateEntry(db, key, 999, input()));
  });

  test("deletes an entry", () => {
    const created = createEntry(db, key, input());

    deleteEntry(db, created.id);

    assert.deepEqual(listEntries(db, key), []);
  });

  test("throws when deleting an unknown id", () => {
    assert.throws(() => deleteEntry(db, 999));
  });
});

describe("setFavorite", () => {
  let db: DatabaseSync;
  let key: Buffer;

  beforeEach(() => {
    db = freshDatabase();
    initializeVault(db, MASTER);
    key = unlock(db, MASTER)!;
  });

  test("marks an entry as favorite", () => {
    const created = createEntry(db, key, input());

    setFavorite(db, key, created.id, true);

    assert.equal(listEntries(db, key)[0].favorite, true);
  });

  test("clears the favorite flag again", () => {
    const created = createEntry(db, key, input({ favorite: true }));

    setFavorite(db, key, created.id, false);

    assert.equal(listEntries(db, key)[0].favorite, false);
  });

  test("leaves every other field untouched", () => {
    const created = createEntry(
      db,
      key,
      input({
        app: "App",
        username: "admin",
        url: "https://acme.dev",
        password: "s3cret",
        comment: "note",
        color: "plum",
      }),
    );

    setFavorite(db, key, created.id, true);

    assert.deepEqual(listEntries(db, key)[0], {
      ...created,
      favorite: true,
      updatedAt: listEntries(db, key)[0].updatedAt,
    });
  });

  test("throws when the id is unknown", () => {
    assert.throws(() => setFavorite(db, key, 999, true));
  });
});

describe("changeMasterPassword", () => {
  let db: DatabaseSync;
  let key: Buffer;

  beforeEach(() => {
    db = freshDatabase();
    initializeVault(db, MASTER);
    key = unlock(db, MASTER)!;
    createEntry(
      db,
      key,
      input({
        app: "App",
        username: "admin",
        url: "https://acme.dev",
        password: "s3cret",
        comment: "note",
      }),
    );
  });

  test("re-encrypts entries so they are readable with the new password", () => {
    changeMasterPassword(db, key, "brand-new-master");

    const newKey = unlock(db, "brand-new-master");
    assert.ok(newKey);
    assert.equal(listEntries(db, newKey)[0].password, "s3cret");
    assert.equal(listEntries(db, newKey)[0].url, "https://acme.dev");
  });

  test("makes the old password stop working", () => {
    changeMasterPassword(db, key, "brand-new-master");

    assert.equal(unlock(db, MASTER), null);
  });

  test("rejects a new password shorter than 8 characters", () => {
    assert.throws(() => changeMasterPassword(db, key, "short"));
  });

  test("leaves the vault usable with the old password when the change fails", () => {
    assert.throws(() => changeMasterPassword(db, key, "short"));

    const stillWorks = unlock(db, MASTER);
    assert.ok(stillWorks);
    assert.equal(listEntries(db, stillWorks)[0].password, "s3cret");
  });
});

describe("backupVault", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "vault-backup-"));
  after(() => rmSync(workspace, { recursive: true, force: true }));

  let source: DatabaseSync;
  let sourcePath: string;
  let key: Buffer;
  let run = 0;

  beforeEach(() => {
    // A file-backed database, not :memory: — the whole point is what lands on
    // disk. migrate() puts it in WAL mode, so writes go to vault.db-wal and
    // stay there: SQLite only checkpoints at 1000 pages or on a clean close,
    // and a personal vault reaches neither.
    sourcePath = path.join(workspace, `source-${run++}.db`);
    source = new DatabaseSync(sourcePath);
    migrate(source);
    initializeVault(source, MASTER);
    key = unlock(source, MASTER)!;

    createEntry(source, key, input({ app: "First", password: "one" }));
    createEntry(source, key, input({ app: "Second", password: "two" }));
  });

  /** Opens a path with no sidecar files beside it, the way a restore would. */
  function readBackAlone(from: string): DatabaseSync {
    const isolated = path.join(workspace, `restored-${run++}.db`);
    // Copying through SQLite rather than the filesystem proves the backup
    // needs no -wal companion: if it did, this restore would come up empty.
    const reader = new DatabaseSync(from);
    reader.exec(`VACUUM INTO '${isolated}'`);
    reader.close();

    return new DatabaseSync(isolated);
  }

  test("writes a file that stands alone without the write-ahead log", () => {
    const destination = path.join(workspace, "backup.db");

    backupVault(source, destination);

    assert.equal(existsSync(destination), true);
    assert.equal(existsSync(`${destination}-wal`), false);

    const restored = readBackAlone(destination);
    const restoredKey = unlock(restored, MASTER);

    assert.ok(restoredKey, "the backup should unlock with the same password");
    assert.deepEqual(
      listEntries(restored, restoredKey).map((entry) => entry.app).sort(),
      ["First", "Second"],
    );
    restored.close();
  });

  /**
   * The regression this function exists for. `cp data/vault.db backup.db` was
   * the documented backup procedure, and on a live vault it copies a stub:
   * every table still lives in the uncheckpointed write-ahead log.
   */
  test("captures rows a bare copy of the database file would miss", () => {
    // What the README used to tell people to do: copy vault.db and nothing
    // else. Establish first that it really does lose the vault, so this test
    // keeps failing if the WAL behaviour that motivated backupVault changes.
    const bareCopy = path.join(workspace, "bare-copy.db");
    copyFileSync(sourcePath, bareCopy);

    const copied = new DatabaseSync(bareCopy);
    const tables = copied
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get() as { n: number };
    copied.close();

    assert.equal(tables.n, 0, "a bare file copy should capture nothing");

    // The same moment in time, taken properly.
    const destination = path.join(workspace, "captures-everything.db");
    backupVault(source, destination);

    const restored = readBackAlone(destination);
    assert.equal(listEntries(restored, unlock(restored, MASTER)!).length, 2);
    restored.close();
  });

  test("refuses to overwrite an existing file rather than truncate it", () => {
    const destination = path.join(workspace, "occupied.db");

    backupVault(source, destination);

    assert.throws(() => backupVault(source, destination));
  });

  test("leaves the source vault usable", () => {
    backupVault(source, path.join(workspace, "after.db"));

    assert.equal(listEntries(source, key).length, 2);
    createEntry(source, key, input({ app: "Third" }));
    assert.equal(listEntries(source, key).length, 3);
  });

  describe("createBackup", () => {
    test("creates the directory when it does not exist yet", () => {
      const directory = path.join(workspace, "never-created", "backups");

      const written = createBackup(source, directory);

      assert.equal(existsSync(written), true);
      assert.equal(path.dirname(written), directory);
    });

    test("names the file after the moment it was taken", () => {
      const directory = path.join(workspace, "named");

      const written = createBackup(
        source,
        directory,
        new Date("2026-08-17T17:40:05.123Z"),
      );

      assert.equal(path.basename(written), "vault-2026-08-17T17-40-05-123.db");
    });

    /** Finder renders a colon in a filename as a slash, and FAT32 rejects it. */
    test("keeps the name free of characters filesystems object to", () => {
      const written = createBackup(source, path.join(workspace, "portable"));

      assert.match(path.basename(written), /^[A-Za-z0-9.\-]+$/);
    });

    test("two backups a millisecond apart do not collide", () => {
      const directory = path.join(workspace, "rapid");

      const first = createBackup(source, directory, new Date("2026-08-17T17:40:05.123Z"));
      const second = createBackup(source, directory, new Date("2026-08-17T17:40:05.124Z"));

      assert.notEqual(first, second);
      assert.equal(existsSync(first), true);
      assert.equal(existsSync(second), true);
    });

    test("produces a restorable vault, not just a file", () => {
      const written = createBackup(source, path.join(workspace, "restorable"));

      const restored = readBackAlone(written);
      const restoredKey = unlock(restored, MASTER);

      assert.ok(restoredKey);
      assert.equal(listEntries(restored, restoredKey).length, 2);
      restored.close();
    });
  });

  describe("restoreVault", () => {
    let backupPath: string;

    beforeEach(() => {
      backupPath = path.join(workspace, `snapshot-${run++}.db`);
      backupVault(source, backupPath);
    });

    test("puts back exactly what the backup held", () => {
      createEntry(source, key, input({ app: "Added after the backup" }));
      deleteEntry(source, listEntries(source, key).find((e) => e.app === "First")!.id);

      restoreVault(source, backupPath);

      assert.deepEqual(
        listEntries(source, unlock(source, MASTER)!).map((e) => e.app).sort(),
        ["First", "Second"],
      );
    });

    test("restores the master password the backup was taken under", () => {
      changeMasterPassword(source, key, "a-different-master-password");
      assert.equal(unlock(source, MASTER), null, "precondition: password changed");

      restoreVault(source, backupPath);

      assert.ok(unlock(source, MASTER), "the backup's password should work again");
      assert.equal(unlock(source, "a-different-master-password"), null);
    });

    /**
     * The vault is being overwritten, so a bad source has to be caught before
     * anything is deleted, not halfway through.
     */
    test("refuses a database that is not a vault, leaving the vault untouched", () => {
      const notAVault = path.join(workspace, "not-a-vault.db");
      const other = new DatabaseSync(notAVault);
      other.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
      other.close();

      assert.throws(() => restoreVault(source, notAVault));
      assert.equal(listEntries(source, key).length, 2);
    });

    test("refuses a file that is not a database at all", () => {
      const garbage = path.join(workspace, "garbage.db");
      writeFileSync(garbage, "this is not a database, it is a text file\n");

      assert.throws(() => restoreVault(source, garbage));
      assert.equal(listEntries(source, key).length, 2);
    });

    test("refuses a path that does not exist", () => {
      assert.throws(() => restoreVault(source, path.join(workspace, "absent.db")));
      assert.equal(listEntries(source, key).length, 2);
    });

    /** Backups predate url/favorite/color; those rows must still come back. */
    test("accepts a backup written before the newer columns existed", () => {
      const legacyPath = path.join(workspace, `legacy-${run++}.db`);
      const legacy = new DatabaseSync(legacyPath);
      legacy.exec(`
        CREATE TABLE vault_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, verifier TEXT NOT NULL
        );
        CREATE TABLE entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT, app TEXT NOT NULL, username TEXT NOT NULL,
          password TEXT NOT NULL, comment TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);
      const meta = source
        .prepare("SELECT salt, verifier FROM vault_meta WHERE id = 1")
        .get() as { salt: string; verifier: string };
      legacy.exec("ALTER TABLE vault_meta ADD COLUMN kdf_version INTEGER");
      legacy
        .prepare(
          "INSERT INTO vault_meta (id, salt, verifier, kdf_version) VALUES (1, ?, ?, ?)",
        )
        .run(meta.salt, meta.verifier, CURRENT_KDF_VERSION);
      legacy
        .prepare(
          `INSERT INTO entries (app, username, password, comment, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          encryptWith("Old row", key),
          encryptWith("", key),
          encryptWith("pw", key),
          encryptWith("", key),
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
        );
      legacy.close();

      restoreVault(source, legacyPath);

      const rows = listEntries(source, unlock(source, MASTER)!);
      assert.deepEqual(rows.map((e) => e.app), ["Old row"]);
      assert.equal(rows[0].url, "");
      assert.equal(rows[0].favorite, false);
    });

    test("leaves the vault usable for writes afterwards", () => {
      restoreVault(source, backupPath);

      const restoredKey = unlock(source, MASTER)!;
      createEntry(source, restoredKey, input({ app: "Written after restore" }));

      assert.equal(listEntries(source, restoredKey).length, 3);
    });
  });

  /**
   * Restoring is the one destructive thing in the app and it has no undo, so
   * the state being replaced is captured first. A mistaken restore then costs
   * a second restore rather than the data.
   */
  describe("safety copy before restoring", () => {
    let safetyDirectory: string;
    let snapshot: string;

    beforeEach(() => {
      safetyDirectory = path.join(workspace, `safety-${run++}`);
      snapshot = path.join(workspace, `snapshot-${run++}.db`);
      backupVault(source, snapshot);
      createEntry(source, key, input({ app: "Only in the live vault" }));
    });

    test("captures the state being replaced", () => {
      const safety = createBackup(source, safetyDirectory);
      restoreVault(source, snapshot);

      // The live vault is now the snapshot...
      assert.equal(
        listEntries(source, unlock(source, MASTER)!).some(
          (e) => e.app === "Only in the live vault",
        ),
        false,
      );

      // ...and what it replaced is still readable.
      const rescued = new DatabaseSync(safety);
      assert.equal(
        listEntries(rescued, unlock(rescued, MASTER)!).some(
          (e) => e.app === "Only in the live vault",
        ),
        true,
      );
      rescued.close();
    });

    test("makes a mistaken restore reversible", () => {
      const safety = createBackup(source, safetyDirectory);
      restoreVault(source, snapshot);

      // Changed their mind: go back to where they were.
      restoreVault(source, safety);

      assert.equal(
        listEntries(source, unlock(source, MASTER)!).some(
          (e) => e.app === "Only in the live vault",
        ),
        true,
      );
    });

    /** Validating first keeps a rejected source from littering the directory. */
    test("a source that is not a vault is rejected before anything is written", () => {
      const garbage = path.join(workspace, `garbage-${run++}.db`);
      writeFileSync(garbage, "not a database\n");

      assert.throws(() => assertRestorable(garbage));
      assert.equal(existsSync(safetyDirectory), false);
    });

    test("accepts a real backup", () => {
      assert.doesNotThrow(() => assertRestorable(snapshot));
    });
  });
});

describe("kdf versioning", () => {
  function fileBackedVault(dir: string): { db: DatabaseSync; path: string } {
    const target = path.join(dir, "vault.db");
    const db = new DatabaseSync(target);
    migrate(db);
    return { db, path: target };
  }

  const workspace = mkdtempSync(path.join(tmpdir(), "vault-kdf-"));
  after(() => rmSync(workspace, { recursive: true, force: true }));

  test("adds the column to a vault created before it existed", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE vault_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, verifier TEXT NOT NULL
      );
    `);

    migrate(db);

    const columns = (db.prepare("PRAGMA table_info(vault_meta)").all() as unknown as {
      name: string;
    }[]).map((c) => c.name);

    assert.ok(columns.includes("kdf_version"));
  });

  test("stamps a new vault with the current version", () => {
    const db = freshDatabase();
    initializeVault(db, MASTER);

    const stored = db.prepare("SELECT kdf_version FROM vault_meta").get() as {
      kdf_version: number;
    };

    assert.equal(stored.kdf_version, CURRENT_KDF_VERSION);
  });

  /**
   * The reason the column exists. A vault written before it must keep opening,
   * and it can only do that if NULL is read as the parameters it was built
   * with rather than whatever is current.
   */
  test("opens a vault whose version is NULL using version 1", () => {
    const db = freshDatabase();

    // Genuinely built at version 1, the way everything written before the
    // column was. Stamping NULL onto a current vault would describe a file
    // that cannot exist: its verifier would not match the version claimed.
    const salt = createSalt();
    db.prepare(
      "INSERT INTO vault_meta (id, salt, verifier, kdf_version) VALUES (1, ?, ?, NULL)",
    ).run(salt.toString("base64"), createVerifier(deriveKey(MASTER, salt, 1)));

    assert.ok(unlock(db, MASTER));
  });

  test("derives with the version the vault records, not the current one", () => {
    const db = freshDatabase();
    const salt = createSalt();

    // A vault built at version 2 while the build still writes version 1.
    const keyV2 = deriveKey(MASTER, salt, 2);
    db.prepare(
      "INSERT INTO vault_meta (id, salt, verifier, kdf_version) VALUES (1, ?, ?, 2)",
    ).run(salt.toString("base64"), createVerifier(keyV2));

    const opened = unlock(db, MASTER);

    assert.ok(opened, "a version 2 vault should open");
    assert.equal(opened.toString("hex"), keyV2.toString("hex"));
    assert.notEqual(
      opened.toString("hex"),
      deriveKey(MASTER, salt, 1).toString("hex"),
      "and must not be the version 1 key",
    );
  });

  test("says so plainly when the version is one this build cannot handle", () => {
    const db = freshDatabase();
    initializeVault(db, MASTER);
    db.exec("UPDATE vault_meta SET kdf_version = 99");

    assert.throws(() => unlock(db, MASTER), /version 99/);
  });

  /** Re-encrypting under a new key is what an upgrade needs, so it doubles as one. */
  test("changing the master password re-stamps the current version", () => {
    const db = freshDatabase();
    const salt = createSalt();
    db.prepare(
      "INSERT INTO vault_meta (id, salt, verifier, kdf_version) VALUES (1, ?, ?, NULL)",
    ).run(salt.toString("base64"), createVerifier(deriveKey(MASTER, salt, 1)));

    changeMasterPassword(db, unlock(db, MASTER)!, "a-brand-new-master");

    const stored = db.prepare("SELECT kdf_version FROM vault_meta").get() as {
      kdf_version: number;
    };
    assert.equal(stored.kdf_version, CURRENT_KDF_VERSION);
    assert.ok(unlock(db, "a-brand-new-master"));
  });

  describe("upgrading on unlock", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vault-upgrade-"));
    after(() => rmSync(dir, { recursive: true, force: true }));

    let vaultPath: string;
    let seq = 0;

    /** A vault stamped at version 1, as everything written before the raise is. */
    function legacyVault(): DatabaseSync {
      vaultPath = path.join(dir, `legacy-${seq++}.db`);
      const db = new DatabaseSync(vaultPath);
      migrate(db);

      const salt = createSalt();
      const key = deriveKey(MASTER, salt, 1);
      db.prepare(
        "INSERT INTO vault_meta (id, salt, verifier, kdf_version) VALUES (1, ?, ?, 1)",
      ).run(salt.toString("base64"), createVerifier(key));
      createEntry(db, key, input({ app: "Written under version 1" }));

      return db;
    }

    test("moves a version 1 vault to the current version", () => {
      const db = legacyVault();

      assert.ok(unlock(db, MASTER));

      const stored = db.prepare("SELECT kdf_version FROM vault_meta").get() as {
        kdf_version: number;
      };
      assert.equal(stored.kdf_version, CURRENT_KDF_VERSION);
      db.close();
    });

    test("keeps the same master password working afterwards", () => {
      const db = legacyVault();
      unlock(db, MASTER);

      assert.ok(unlock(db, MASTER), "the password must not change");
      assert.equal(unlock(db, "something else"), null);
      db.close();
    });

    test("keeps every entry readable through the upgrade", () => {
      const db = legacyVault();

      const key = unlock(db, MASTER)!;

      assert.deepEqual(
        listEntries(db, key).map((e) => e.app),
        ["Written under version 1"],
      );
      db.close();
    });

    test("returns a key that actually decrypts, not the pre-upgrade one", () => {
      const db = legacyVault();
      const key = unlock(db, MASTER)!;

      // Would throw if the returned key were the old one.
      assert.doesNotThrow(() => listEntries(db, key));
      db.close();
    });

    test("leaves a vault already at the current version untouched", () => {
      const db = freshDatabase();
      initializeVault(db, MASTER);
      const before = db.prepare("SELECT salt FROM vault_meta").get() as {
        salt: string;
      };

      unlock(db, MASTER);

      const after = db.prepare("SELECT salt FROM vault_meta").get() as {
        salt: string;
      };
      assert.equal(after.salt, before.salt, "no pointless re-encryption");
    });

    /**
     * The upgrade is an improvement, not a precondition. Someone whose vault
     * cannot be written — read-only media, a locked file — must still get in.
     */
    test("still unlocks when the upgrade cannot be written", () => {
      legacyVault().close();

      const readOnly = new DatabaseSync(vaultPath, { readOnly: true });

      const key = unlock(readOnly, MASTER);
      assert.ok(key, "a read-only vault must still open");
      assert.deepEqual(
        listEntries(readOnly, key).map((e) => e.app),
        ["Written under version 1"],
      );
      readOnly.close();
    });
  });

  test("carries the version across a restore", () => {
    const { db } = fileBackedVault(mkdtempSync(path.join(workspace, "carry-")));
    initializeVault(db, MASTER);
    db.exec("UPDATE vault_meta SET kdf_version = 2");
    // Re-stamp the verifier so the vault is genuinely a version 2 vault.
    const salt = createSalt();
    db.prepare("UPDATE vault_meta SET salt = ?, verifier = ?").run(
      salt.toString("base64"),
      createVerifier(deriveKey(MASTER, salt, 2)),
    );

    const snapshot = path.join(workspace, `carried-${Date.now()}.db`);
    backupVault(db, snapshot);
    restoreVault(db, snapshot);

    const stored = db.prepare("SELECT kdf_version FROM vault_meta").get() as {
      kdf_version: number;
    };
    assert.equal(stored.kdf_version, 2, "a restore must not reset the version");
    assert.ok(unlock(db, MASTER), "and the vault must still open");
    db.close();
  });

  test("restores a backup taken before the column existed", () => {
    const directory = mkdtempSync(path.join(workspace, "legacy-"));
    const { db } = fileBackedVault(directory);
    initializeVault(db, MASTER);
    createEntry(db, unlock(db, MASTER)!, input({ app: "Older than the column" }));

    // A backup whose vault_meta predates kdf_version entirely.
    const legacyPath = path.join(directory, "legacy-backup.db");
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`
      CREATE TABLE vault_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, verifier TEXT NOT NULL
      );
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, app TEXT NOT NULL, username TEXT NOT NULL,
        password TEXT NOT NULL, comment TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    // A backup with no kdf_version column genuinely predates versioning, so it
    // genuinely holds a version 1 key. Building it any other way describes a
    // file that could never have existed.
    const legacySalt = createSalt();
    legacy
      .prepare("INSERT INTO vault_meta (id, salt, verifier) VALUES (1, ?, ?)")
      .run(
        legacySalt.toString("base64"),
        createVerifier(deriveKey(MASTER, legacySalt, 1)),
      );
    legacy.close();

    assert.doesNotThrow(() => restoreVault(db, legacyPath));
    assert.ok(unlock(db, MASTER), "a pre-column backup must still unlock");
    db.close();
  });
});
