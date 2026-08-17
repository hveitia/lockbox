"use server";

import { revalidatePath } from "next/cache";

import {
  changeMasterPassword,
  createEntry,
  deleteEntry,
  initializeVault,
  isInitialized,
  setFavorite,
  updateEntry,
} from "@/lib/vault.ts";
import type { EntryInput } from "@/lib/entry.ts";
import {
  closeSession,
  getDatabase,
  getSessions,
  openSession,
  requireSessionKey,
  setSessionCookie,
  writeBackup,
} from "@/lib/server.ts";
import { failed, OK, succeeded, type ActionState } from "./action-state.ts";

/** Flattens an input for the error state, which round-trips as strings. */
function toFormValues(input: EntryInput): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).map(([field, value]) => [field, String(value)]),
  );
}

function readEntryInput(formData: FormData): EntryInput {
  return {
    app: String(formData.get("app") ?? ""),
    username: String(formData.get("username") ?? ""),
    url: String(formData.get("url") ?? ""),
    password: String(formData.get("password") ?? ""),
    comment: String(formData.get("comment") ?? ""),
    // An unchecked checkbox sends nothing at all.
    favorite: formData.get("favorite") !== null,
    // Left unvalidated on purpose: vault.ts validates inside the try/catch,
    // so a bad value surfaces as a form error instead of an unhandled throw.
    color: String(formData.get("color") ?? "") as EntryInput["color"],
  };
}

export async function setupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const masterPassword = String(formData.get("masterPassword") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (masterPassword !== confirmation) {
    return failed(new Error("The two master passwords do not match"));
  }

  try {
    initializeVault(getDatabase(), masterPassword);
    await openSession(masterPassword);
  } catch (error) {
    return failed(error);
  }

  revalidatePath("/");
  return OK;
}

export async function unlockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const masterPassword = String(formData.get("masterPassword") ?? "");

  if (!isInitialized(getDatabase())) {
    return failed(new Error("This vault has not been set up yet"));
  }

  if (!(await openSession(masterPassword))) {
    return failed(new Error("Wrong master password"));
  }

  revalidatePath("/");
  return OK;
}

export async function lockAction(): Promise<void> {
  await closeSession();
  revalidatePath("/");
}

/**
 * Nothing on screen changes, so this does not revalidate. It requires an
 * unlocked vault only so a locked browser cannot make the server write files.
 */
export async function backupAction(_prev: ActionState): Promise<ActionState> {
  try {
    await requireSessionKey();

    return succeeded(writeBackup());
  } catch (error) {
    return failed(error);
  }
}

export async function createEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const input = readEntryInput(formData);

  try {
    createEntry(getDatabase(), await requireSessionKey(), input);
  } catch (error) {
    return failed(error, toFormValues(input));
  }

  revalidatePath("/");
  return OK;
}

export async function updateEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = Number(formData.get("id"));
  const input = readEntryInput(formData);

  try {
    updateEntry(getDatabase(), await requireSessionKey(), id, input);
  } catch (error) {
    return failed(error, toFormValues(input));
  }

  revalidatePath("/");
  return OK;
}

export async function toggleFavoriteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    setFavorite(
      getDatabase(),
      await requireSessionKey(),
      Number(formData.get("id")),
      formData.get("favorite") === "true",
    );
  } catch (error) {
    return failed(error);
  }

  revalidatePath("/");
  return OK;
}

export async function deleteEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireSessionKey();
    deleteEntry(getDatabase(), Number(formData.get("id")));
  } catch (error) {
    return failed(error);
  }

  revalidatePath("/");
  return OK;
}

export async function changeMasterPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const next = String(formData.get("newMasterPassword") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (next !== confirmation) {
    return failed(new Error("The two new master passwords do not match"));
  }

  try {
    const currentKey = await requireSessionKey();
    const newKey = changeMasterPassword(getDatabase(), currentKey, next);

    // Every previously unlocked session holds the old key, which no longer
    // decrypts anything. Drop them all and re-issue one for this browser.
    getSessions().destroyAll();
    await setSessionCookie(getSessions().create(newKey));
  } catch (error) {
    return failed(error);
  }

  revalidatePath("/");
  return OK;
}
