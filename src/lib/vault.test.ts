import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

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
} from "./vault.ts";
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
