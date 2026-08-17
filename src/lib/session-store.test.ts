import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createSessionStore, type SessionStore } from "./session-store.ts";

const KEY = Buffer.alloc(32, 7);
const TTL = 1000;

describe("createSessionStore", () => {
  let clock: number;
  let store: SessionStore;

  beforeEach(() => {
    clock = 0;
    store = createSessionStore({ ttlMs: TTL, now: () => clock });
  });

  test("returns the key for a live session", () => {
    const id = store.create(KEY);

    assert.deepEqual(store.get(id), KEY);
  });

  test("issues a distinct id per session", () => {
    assert.notEqual(store.create(KEY), store.create(KEY));
  });

  test("returns null for an unknown id", () => {
    assert.equal(store.get("nope"), null);
  });

  test("returns null when no id is given", () => {
    assert.equal(store.get(undefined), null);
  });

  test("returns null once the ttl has elapsed", () => {
    const id = store.create(KEY);

    clock += TTL + 1;

    assert.equal(store.get(id), null);
  });

  test("sliding expiry: activity extends the session", () => {
    const id = store.create(KEY);

    clock += TTL - 1;
    assert.deepEqual(store.get(id), KEY);

    clock += TTL - 1;
    assert.deepEqual(store.get(id), KEY, "the read should have refreshed the ttl");
  });

  test("forgets an expired session instead of keeping it around", () => {
    const id = store.create(KEY);
    clock += TTL + 1;

    store.get(id);

    assert.equal(store.size(), 0);
  });

  test("destroy locks the session immediately", () => {
    const id = store.create(KEY);

    store.destroy(id);

    assert.equal(store.get(id), null);
  });

  test("destroy is a no-op for an unknown id", () => {
    assert.doesNotThrow(() => store.destroy("nope"));
  });

  test("destroyAll locks every session", () => {
    const a = store.create(KEY);
    const b = store.create(KEY);

    store.destroyAll();

    assert.equal(store.get(a), null);
    assert.equal(store.get(b), null);
  });
});
