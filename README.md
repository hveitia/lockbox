# Vault

A local-only credential store for your own projects. Each entry holds an **app**, a
**URL**, a **user**, a **password**, and a free-text **note**, and can optionally be
marked a **favorite** and given a **color**.

The URL is optional. A bare host is stored as `https://`, and anything that is not
`http`/`https` is refused — the value is rendered as a link, so a `javascript:` or
`data:` scheme would be stored XSS waiting for a click.

## Favorites and colors

Both are optional and default to off: a new entry is not a favorite and has no
color.

- **Favorite** pins an entry to the top of the list. The star on each card toggles
  it in one click without touching anything else in the entry.
- **Color** tints the card's link, star, and password band. The palette is a fixed
  list of fourteen colors plus "no color", ordered around the color wheel; only the
  *name* is stored, and the stylesheet owns the actual values, so nothing typed can
  reach the render path.

To add a color, append a name to `ENTRY_COLORS` in `src/lib/entry.ts` **and** add a
matching `.tone-<name>` rule in `src/app/globals.css`. `src/lib/colors.test.ts`
fails if either half is missing, or if two colors resolve to the same value. Never
rename or remove a name — stored rows reference it.

Filter with the **Favorites** button and the color swatches under the search box.
They combine with each other and with the search text. Only colors currently in use
are offered, so the filter row never shows a swatch that would return nothing.

Nothing leaves the machine: the app binds to `127.0.0.1`, has no network calls, and
the database is a single SQLite file under `data/`.

## Starting the app

Every command below runs from the repository root.

### First time

```bash
pnpm install
pnpm build
pnpm start
```

Open http://localhost:3000. The first screen asks you to create the master
password. There is no recovery, so pick one you will not lose.

### Every time after that

```bash
pnpm start
```

That is the whole daily command. Rebuild only after changing the code:

```bash
pnpm build && pnpm start
```

Stop the server with `Ctrl-C` in the terminal running it.

The app does **not** start on login, on purpose: a vault that is always listening is
always available to anything running as your user. Starting it by hand is part of
the trust boundary.

### While changing the code

```bash
pnpm dev
```

Hot reload, slower pages, same database. Restarting either server re-locks the
vault.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm start` | Run the built app on http://localhost:3000 |
| `pnpm build` | Compile for production — needed after code changes |
| `pnpm dev` | Development server with hot reload |
| `pnpm test` | Unit tests for crypto, vault, and sessions |
| `pnpm typecheck` | TypeScript, no emit |

Both `start` and `dev` bind to `127.0.0.1`, so the vault is unreachable from other
machines on your network.

### If port 3000 is busy

```bash
PORT=3100 pnpm start
```

Use the environment variable rather than a `-p` flag: `pnpm` forwards `--` to Next
verbatim and Next reads it as a directory argument.

## How the encryption works

- The master password is **never stored**. A 32-byte key is derived from it with
  scrypt (N=2^15) over a random per-vault salt.
- Every field of every entry — app, URL, user, password, note, favorite, color — is
  encrypted with AES-256-GCM before it reaches the disk. The database file contains
  no plaintext. Sorting and filtering therefore happen in memory after decrypting,
  which is fine at the scale this vault is built for.
- The vault stores a short *verifier* token: a constant string encrypted under the
  key. A wrong master password fails to decrypt it, which is how a bad unlock is
  detected without ever comparing passwords.
- The derived key lives in the server process's memory only, keyed by an httpOnly
  session cookie. It is gone when the process exits.

The vault re-locks after 30 minutes of inactivity, when you press **Lock**, and
whenever the server restarts.

**There is no recovery.** Lose the master password and the entries are unreadable.
Changing it (via **Master password**) re-encrypts every entry under the new key.

## Backups

Press **Backup**. It writes one self-contained file into `data/backups/` and shows
you the path. Copy *that* file wherever you like — it is encrypted at rest, so a
backup on a sync service is still unreadable without the master password.

From a terminal, the same thing:

```bash
sqlite3 data/vault.db "VACUUM INTO 'vault-backup.db'"
```

**Do not copy `data/vault.db` yourself.** The vault runs in SQLite's WAL mode, so
writes land in `data/vault.db-wal` and stay there until SQLite folds them back into
the main file — which it does at 1000 pages or on a clean shutdown, and a personal
vault reaches neither. A copy of `vault.db` on its own is usually a stub with no
tables in it at all. Worse, it fails *silently*: nothing complains until the day you
try to restore it.

For the same reason, do not point a sync client at `data/` itself. Copying
`vault.db` and `vault.db-wal` at different moments, or writing them back underneath
a running app, can corrupt the live vault. Sync the backup file, not the directory
the app is using.

`data/` is gitignored, backups included.

## Desktop app

`desktop_app/` is a native macOS client for this same vault, written in Flutter.
It opens `data/vault.db` in place — same schema, same crypto, same entries — so
the two apps are interchangeable. See `desktop_app/README.md`.

```bash
cd desktop_app && flutter run -d macos
```

## What this is not

This trusts the machine it runs on. It does not defend against malware already
running as your user, and it is not built to be exposed to a network. Do not put it
behind a public hostname.

## Development

```bash
pnpm test        # crypto, vault, and session unit tests
pnpm typecheck
```

| Path | Role |
| --- | --- |
| `src/lib/entry.ts` | Shared entry shape, color list, URL normalization |
| `src/lib/crypto.ts` | Key derivation and AES-256-GCM encrypt/decrypt |
| `src/lib/vault.ts` | Schema, unlock, entry CRUD, master password rotation, backup |
| `src/lib/session-store.ts` | In-memory unlocked keys with sliding expiry |
| `src/lib/server.ts` | Database and session singletons, cookie handling |
| `src/app/actions.ts` | Server actions |
| `src/components/` | UI |
