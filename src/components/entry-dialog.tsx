"use client";

import { useActionState, useEffect, useState } from "react";

import { createEntryAction, updateEntryAction } from "@/app/actions.ts";
import { errorOf, fieldValue, IDLE } from "@/app/action-state.ts";
import { DEFAULT_COLOR, ENTRY_COLORS, type Entry } from "@/lib/entry.ts";
import { Dialog } from "./dialog.tsx";

export function EntryDialog({
  entry,
  onClose,
}: {
  entry: Entry | "new";
  onClose: () => void;
}) {
  const editing = entry !== "new";
  const [state, formAction, pending] = useActionState(
    editing ? updateEntryAction : createEntryAction,
    IDLE,
  );
  const error = errorOf(state);

  // A rejected submission comes back with what was typed, so nothing is lost.
  const value = (name: keyof Entry) =>
    fieldValue(state, name, editing ? String(entry[name]) : "");

  const startingColor = value("color") || DEFAULT_COLOR;
  const startingFavorite = value("favorite") === "true";

  // Uncontrolled inputs ignore a changed defaultValue, so a rejected attempt
  // remounts the form to put the submitted values back on screen.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state.status === "ok") onClose();
    if (state.status === "error") setAttempt((n) => n + 1);
  }, [state, onClose]);

  return (
    <Dialog
      title={editing ? "Edit credentials" : "Add credentials"}
      onClose={onClose}
    >
      <form key={attempt} action={formAction} className="space-y-4">
        {editing && <input type="hidden" name="id" value={entry.id} />}

        <div>
          <label className="label" htmlFor="app">
            App
          </label>
          <input
            id="app"
            name="app"
            className="field"
            defaultValue={value("app")}
            placeholder="Acme dashboard"
            autoFocus
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="url">
            URL
          </label>
          <input
            id="url"
            name="url"
            className="field"
            defaultValue={value("url")}
            placeholder="acme.dev/admin"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div>
          <label className="label" htmlFor="username">
            User
          </label>
          <input
            id="username"
            name="username"
            className="field"
            defaultValue={value("username")}
            placeholder="admin"
            autoComplete="off"
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            className="field"
            defaultValue={value("password")}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="comment">
            Note
          </label>
          <textarea
            id="comment"
            name="comment"
            className="field resize-y"
            rows={3}
            defaultValue={value("comment")}
            placeholder="Staging only — rotate before launch"
          />
        </div>

        <div>
          <span className="label">Color</span>
          <div className="flex flex-wrap gap-2">
            {ENTRY_COLORS.map((color) => (
              <label
                key={color}
                // The radio itself is sr-only, so the label carries the focus ring.
                className={`tone-${color} cursor-pointer rounded-sm border border-ink-line p-2 transition-colors hover:border-[var(--accent)] has-checked:border-[var(--accent)] has-checked:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brass`}
                title={color === DEFAULT_COLOR ? "No color" : color}
              >
                <input
                  type="radio"
                  name="color"
                  value={color}
                  defaultChecked={color === startingColor}
                  className="sr-only"
                />
                <span className="swatch block" aria-hidden="true" />
                <span className="sr-only">
                  {color === DEFAULT_COLOR ? "No color" : color}
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            name="favorite"
            defaultChecked={startingFavorite}
            className="size-4 accent-brass"
          />
          Pin to the top as a favorite
        </label>

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
            {pending ? "Saving…" : editing ? "Save changes" : "Add to vault"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
