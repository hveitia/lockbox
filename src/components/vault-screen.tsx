"use client";

import { useActionState, useMemo, useState } from "react";

import { backupAction, lockAction } from "@/app/actions.ts";
import { IDLE } from "@/app/action-state.ts";
import { DEFAULT_COLOR, ENTRY_COLORS, type Entry, type EntryColor } from "@/lib/entry.ts";
import { EntryDialog } from "./entry-dialog.tsx";
import { EntryRow } from "./entry-row.tsx";
import { MasterPasswordDialog } from "./master-password-dialog.tsx";
import { RestoreDialog } from "./restore-dialog.tsx";

type ColorFilter = EntryColor | "any";

function matches(entry: Entry, query: string): boolean {
  const haystack =
    `${entry.app} ${entry.username} ${entry.url} ${entry.comment}`.toLowerCase();

  return haystack.includes(query);
}

export function VaultScreen({
  entries,
  backups,
}: {
  entries: Entry[];
  backups: string[];
}) {
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [color, setColor] = useState<ColorFilter>("any");
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [changingMaster, setChangingMaster] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backup, runBackup, backingUp] = useActionState(backupAction, IDLE);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return entries.filter(
      (entry) =>
        (!needle || matches(entry, needle)) &&
        (!favoritesOnly || entry.favorite) &&
        (color === "any" || entry.color === color),
    );
  }, [entries, query, favoritesOnly, color]);

  const filtering = Boolean(query.trim()) || favoritesOnly || color !== "any";

  // Only offer a color that something actually uses — an empty filter is noise.
  const usedColors = useMemo(() => {
    const used = new Set(entries.map((entry) => entry.color));

    return ENTRY_COLORS.filter((c) => used.has(c));
  }, [entries]);

  function clearFilters() {
    setQuery("");
    setFavoritesOnly(false);
    setColor("any");
  }

  return (
    <main className="w-full px-6 py-10 sm:px-10">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="text-[0.6875rem] tracking-[0.28em] text-brass-dim uppercase">
            Local only
          </p>
          <h1 className="mt-2 font-display text-4xl leading-none font-semibold">
            Vault
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <form action={runBackup}>
            <button type="submit" className="btn-quiet" disabled={backingUp}>
              {backingUp ? "Backing up…" : "Backup"}
            </button>
          </form>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => setRestoring(true)}
          >
            Restore
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => setChangingMaster(true)}
          >
            Master password
          </button>
          <form action={lockAction}>
            <button type="submit" className="btn-quiet">
              Lock
            </button>
          </form>
        </div>
      </header>

      {backup.status !== "idle" && (
        <p
          role="status"
          className={`mt-4 text-sm ${
            backup.status === "error" ? "text-red-400" : "text-brass-dim"
          }`}
        >
          {backup.status === "error" ? (
            backup.message
          ) : (
            <>
              Backup written to{" "}
              <code className="break-all text-parchment">{backup.detail}</code>.
              Copy that single file anywhere — it needs nothing beside it.
            </>
          )}
        </p>
      )}

      <div className="mt-5 h-px w-full bg-brass/40" />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="field max-w-lg flex-1 basis-56"
          placeholder="Search apps, sites, users, notes…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search the vault"
        />
        <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
          Add credentials
        </button>
      </div>

      {entries.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((on) => !on)}
            className={`btn-quiet ${
              favoritesOnly ? "!border-brass !text-brass" : ""
            }`}
          >
            Favorites
          </button>

          {usedColors.length > 1 && (
            <>
              <span className="mx-1 h-5 w-px bg-ink-line" aria-hidden="true" />

              {usedColors.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={color === option}
                  title={option === DEFAULT_COLOR ? "No color" : option}
                  onClick={() =>
                    setColor((current) => (current === option ? "any" : option))
                  }
                  className={`tone-${option} rounded-sm border p-1.5 transition-colors ${
                    color === option
                      ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]"
                      : "border-ink-line hover:border-[var(--accent)]"
                  }`}
                >
                  <span className="swatch block" aria-hidden="true" />
                  <span className="sr-only">
                    Filter by {option === DEFAULT_COLOR ? "no color" : option}
                  </span>
                </button>
              ))}
            </>
          )}

          {filtering && (
            <button type="button" className="btn-quiet" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>
      )}

      <p className="mt-3 font-mono text-xs text-muted">
        {entries.length === 0
          ? "empty"
          : filtering
            ? `${visible.length} of ${entries.length} stored`
            : `${entries.length} stored`}
      </p>

      {entries.length === 0 ? (
        <p className="mt-10 text-sm leading-relaxed text-muted">
          Nothing stored yet. Add the first set of credentials and they get encrypted
          before they touch the disk.
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-10 text-sm text-muted">Nothing matches these filters.</p>
      ) : (
        // min() keeps the track from forcing horizontal scroll on a phone,
        // where 24rem is wider than the viewport.
        <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(min(24rem,100%),1fr))] gap-4">
          {visible.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onEdit={setEditing} />
          ))}
        </ul>
      )}

      {editing && <EntryDialog entry={editing} onClose={() => setEditing(null)} />}

      {changingMaster && (
        <MasterPasswordDialog onClose={() => setChangingMaster(false)} />
      )}

      {restoring && (
        <RestoreDialog backups={backups} onClose={() => setRestoring(false)} />
      )}
    </main>
  );
}
