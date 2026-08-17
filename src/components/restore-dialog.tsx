"use client";

import { useActionState, useState } from "react";

import { restoreAction } from "@/app/actions.ts";
import { errorOf, IDLE } from "@/app/action-state.ts";
import { Dialog } from "./dialog.tsx";

/** Turns vault-2026-08-17T17-40-05-123.db back into something readable. */
function readableDate(name: string): string {
  const stamp = name.replace(/^vault-/, "").replace(/\.db$/, "");
  const [date, time] = stamp.split("T");
  if (!date || !time) return name;

  const [hours, minutes, seconds] = time.split("-");

  return `${date} at ${hours}:${minutes}:${seconds}`;
}

export function RestoreDialog({
  backups,
  onClose,
}: {
  backups: string[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(restoreAction, IDLE);
  const [selected, setSelected] = useState(backups[0] ?? "");
  const error = errorOf(state);

  // No success branch closes this dialog: restoring drops the session, so the
  // page re-renders as the unlock screen and takes the dialog with it.
  return (
    <Dialog title="Restore a backup" onClose={onClose}>
      {backups.length === 0 ? (
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-muted">
            There are no backups yet. Press <strong>Backup</strong> first — it
            writes one into <code>data/backups/</code>.
          </p>
          <div className="flex justify-end">
            <button type="button" className="btn-quiet" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form action={formAction} className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">
            This replaces everything in the vault with the contents of the
            backup. Anything added since it was taken is lost.
          </p>
          <p className="text-sm leading-relaxed text-muted">
            The backup carries its own master password — the one in use when it
            was taken. The vault locks afterwards so you can sign back in with
            it.
          </p>

          <div>
            <label className="label" htmlFor="name">
              Backup
            </label>
            <select
              id="name"
              name="name"
              className="field"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              autoFocus
            >
              {backups.map((backup) => (
                <option key={backup} value={backup}>
                  {readableDate(backup)}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Restoring…" : "Replace the vault"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
