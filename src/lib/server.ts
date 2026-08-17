import "server-only";

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cookies } from "next/headers";

import {
  assertRestorable,
  createBackup,
  migrate,
  restoreVault,
  unlock as unlockVault,
} from "./vault.ts";
import { createSessionStore, type SessionStore } from "./session-store.ts";

export const SESSION_COOKIE = "vault_session";
const SESSION_TTL_MS = 30 * 60 * 1000;

const DB_PATH =
  process.env.VAULT_DB_PATH ?? path.join(process.cwd(), "data", "vault.db");

/**
 * Next's dev server re-evaluates modules on every hot reload. Parking the
 * database handle and the unlocked keys on globalThis keeps a code edit from
 * silently logging you out.
 */
const globalRef = globalThis as typeof globalThis & {
  __vaultDb?: DatabaseSync;
  __vaultSessions?: SessionStore;
};

export function getDatabase(): DatabaseSync {
  if (!globalRef.__vaultDb) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    migrate(db);
    globalRef.__vaultDb = db;
  }

  return globalRef.__vaultDb;
}

/**
 * Writes a timestamped backup beside the vault and returns its path.
 *
 * It lands next to the database rather than somewhere of the user's choosing
 * because the server has no file picker — the point is to produce one
 * self-contained file that is safe to copy anywhere, which a copy of
 * `vault.db` is not. Backups are inside `data/`, so they are gitignored too.
 */
export function writeBackup(): string {
  return createBackup(getDatabase(), path.join(path.dirname(DB_PATH), "backups"));
}

function backupDirectory(): string {
  return path.join(path.dirname(DB_PATH), "backups");
}

/** Backups on disk, newest first. Names are timestamps, so this sorts by name. */
export function listBackups(): string[] {
  const directory = backupDirectory();
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => name.endsWith(".db"))
    .sort()
    .reverse();
}

/**
 * Restores a backup by name and re-locks the vault.
 *
 * Every unlocked session holds a key derived from the salt that was just
 * replaced, so none of them decrypt anything any more. Dropping them is not
 * tidiness — leaving one alive would leave a browser sitting in front of a
 * vault it can no longer read, showing decryption failures instead of a
 * password prompt.
 *
 * Only a plain filename is accepted: it comes from a browser, so a path is
 * untrusted input and `../..` must not be able to point this anywhere.
 */
export function restoreBackup(name: string): void {
  if (name !== path.basename(name) || !name.endsWith(".db")) {
    throw new Error("That is not a backup name");
  }

  const source = path.join(backupDirectory(), name);

  // Validate before writing anything: a rejected source should not leave a
  // safety copy behind for a restore that never happened.
  assertRestorable(source);

  // Restore is the one destructive thing here and it has no undo, so the state
  // about to be replaced becomes a backup of its own first. Picking the wrong
  // file then costs a second restore rather than the data. It lands in the same
  // directory, so it shows up at the top of the list as the newest backup.
  createBackup(getDatabase(), backupDirectory());

  restoreVault(getDatabase(), source);
  getSessions().destroyAll();
}

export function getSessions(): SessionStore {
  globalRef.__vaultSessions ??= createSessionStore({ ttlMs: SESSION_TTL_MS });

  return globalRef.__vaultSessions;
}

/** The vault key for the current request, or null when locked. */
export async function getSessionKey(): Promise<Buffer | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;

  return getSessions().get(id);
}

/** Same as `getSessionKey`, but throws — for actions that must not run while locked. */
export async function requireSessionKey(): Promise<Buffer> {
  const key = await getSessionKey();

  if (!key) throw new Error("Vault is locked");

  return key;
}

/** Opens a session for a valid master password and sets the cookie. */
export async function openSession(masterPassword: string): Promise<boolean> {
  const key = unlockVault(getDatabase(), masterPassword);
  if (!key) return false;

  await setSessionCookie(getSessions().create(key));

  return true;
}

export async function setSessionCookie(id: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function closeSession(): Promise<void> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;

  getSessions().destroy(id);
  store.delete(SESSION_COOKIE);
}
