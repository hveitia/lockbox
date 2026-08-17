"use client";

import { useActionState, useEffect, useState } from "react";

import { deleteEntryAction, toggleFavoriteAction } from "@/app/actions.ts";
import { errorOf, IDLE } from "@/app/action-state.ts";
import type { Entry } from "@/lib/entry.ts";

const DOTS = "•".repeat(14);

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.14 1 5.86L12 16.94 6.75 19.7l1-5.86L3.5 9.7l5.9-.9z" />
    </svg>
  );
}

/** Shows acme.dev/admin rather than https://acme.dev/admin — the href keeps the scheme. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function EntryRow({
  entry,
  onEdit,
}: {
  entry: Entry;
  onEdit: (entry: Entry) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"username" | "password" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteState, deleteFormAction, deleting] = useActionState(
    deleteEntryAction,
    IDLE,
  );
  const [, favoriteFormAction] = useActionState(toggleFavoriteAction, IDLE);
  const deleteError = errorOf(deleteState);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(null), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(field: "username" | "password") {
    await navigator.clipboard.writeText(entry[field]);
    setCopied(field);
  }

  return (
    <li
      className={`tone-${entry.color} flex flex-col rounded-sm border border-ink-line bg-ink-raised p-5`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <form action={favoriteFormAction} className="shrink-0 pt-0.5">
              <input type="hidden" name="id" value={entry.id} />
              <input
                type="hidden"
                name="favorite"
                value={String(!entry.favorite)}
              />
              <button
                type="submit"
                aria-pressed={entry.favorite}
                title={entry.favorite ? "Remove from favorites" : "Add to favorites"}
                className={
                  entry.favorite
                    ? "text-[var(--accent)]"
                    : "text-ink-line transition-colors hover:text-muted"
                }
              >
                <StarIcon filled={entry.favorite} />
                <span className="sr-only">
                  {entry.favorite ? "Remove from favorites" : "Add to favorites"}
                </span>
              </button>
            </form>

            <h2 className="font-display text-xl leading-tight font-semibold break-words">
              {entry.app}
            </h2>
          </div>

          {/* One line each, truncated: a card stays the same shape whatever it holds.
              pl-7 lines these up under the title, past the star. */}
          <div className="mt-1 flex flex-col items-start gap-y-0.5 pl-7 font-mono text-sm">
            {entry.url && (
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer noopener"
                title={entry.url}
                className="max-w-full truncate text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-4 transition-colors hover:decoration-[var(--accent)]"
              >
                {displayUrl(entry.url)}
              </a>
            )}

            {entry.username && (
              <button
                type="button"
                onClick={() => copy("username")}
                title={`Copy ${entry.username}`}
                className="max-w-full truncate text-muted transition-colors hover:text-parchment"
              >
                {copied === "username" ? "Copied user" : entry.username}
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn-quiet" onClick={() => onEdit(entry)}>
            Edit
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </button>
        </div>
      </div>

      {entry.comment && (
        <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-muted">
          {entry.comment}
        </p>
      )}

      {/* mt-auto pins the password to the bottom so the bands line up across columns. */}
      <div className="mt-auto pt-4">
        <div
          key={copied === "password" ? "struck" : "idle"}
          className={`brass-band flex items-center justify-between gap-3 px-3 py-2 ${
            copied === "password" ? "brass-band--struck" : ""
          }`}
        >
          <code className="min-w-0 overflow-x-auto font-mono text-sm whitespace-pre">
            {revealed ? entry.password : DOTS}
          </code>

          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="btn-quiet"
              onClick={() => setRevealed((value) => !value)}
              aria-pressed={revealed}
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
            <button
              type="button"
              className="btn-quiet"
              onClick={() => copy("password")}
            >
              {copied === "password" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      {confirmingDelete && (
        <form
          action={deleteFormAction}
          className="mt-3 flex flex-wrap items-center gap-3 text-sm"
        >
          <input type="hidden" name="id" value={entry.id} />
          <span className="text-alarm">Delete {entry.app} for good?</span>
          <button
            type="submit"
            disabled={deleting}
            className="btn-quiet !border-alarm !text-alarm"
          >
            {deleting ? "Deleting…" : "Yes, delete"}
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => setConfirmingDelete(false)}
          >
            Keep it
          </button>
        </form>
      )}

      {deleteError && (
        <p role="alert" className="mt-2 text-sm text-alarm">
          {deleteError}
        </p>
      )}
    </li>
  );
}
