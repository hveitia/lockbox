"use client";

import { useActionState, useEffect } from "react";

import { changeMasterPasswordAction } from "@/app/actions.ts";
import { errorOf, IDLE } from "@/app/action-state.ts";
import { MIN_MASTER_PASSWORD_LENGTH } from "@/lib/entry.ts";
import { Dialog } from "./dialog.tsx";

export function MasterPasswordDialog({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(
    changeMasterPasswordAction,
    IDLE,
  );
  const error = errorOf(state);

  useEffect(() => {
    if (state.status === "ok") onClose();
  }, [state, onClose]);

  return (
    <Dialog title="Change master password" onClose={onClose}>
      <form action={formAction} className="space-y-4">
        <p className="text-sm leading-relaxed text-muted">
          Every stored password gets re-encrypted under the new one. At least{" "}
          {MIN_MASTER_PASSWORD_LENGTH} characters.
        </p>

        <div>
          <label className="label" htmlFor="newMasterPassword">
            New master password
          </label>
          <input
            id="newMasterPassword"
            name="newMasterPassword"
            type="password"
            className="field"
            autoComplete="new-password"
            autoFocus
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="confirmation">
            Type it again
          </label>
          <input
            id="confirmation"
            name="confirmation"
            type="password"
            className="field"
            autoComplete="new-password"
            required
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-alarm">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Re-encrypting…" : "Change it"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
