# Vault Desktop

A native macOS front end for the same vault the web app uses. It opens
`data/vault.db` in place — no copy, no sync, no server. An entry added here is
there the next time the web app is started, and the other way around.

## Requirements

- Flutter (stable channel) with macOS desktop enabled
- Xcode command line tools

## Running it

From this folder:

```bash
flutter run -d macos
```

For a standalone app bundle:

```bash
flutter build macos --release
open build/macos/Build/Products/Release/Vault.app
```

## First launch

The app does not guess where the vault lives. On first launch it asks for the
file:

1. Click **Choose vault.db…**
2. Pick `vault/data/vault.db` — the same file the web app reads
3. Enter the master password

The path is remembered, so later launches go straight to the unlock screen. If
the vault file has moved or been deleted, the app returns to the locate screen.

If the file picked has no vault in it yet, the app offers to create one — the
same setup flow the web app shows on a fresh install.

## What it shares with the web app

Both apps read and write the same SQLite file with the same format, so the
desktop app is not a viewer — it is a second full client:

- **Key derivation**: scrypt (N=32768, r=8, p=1) over the NFKC-normalized
  master password and the stored salt, 32-byte key. The normalization is
  load-bearing — macOS can hand this app a decomposed `ñ` where the browser
  gives a composed one, and without it the same typed password derives a
  different key and unlocking fails.
- **Encryption**: AES-256-GCM per field, with a fresh IV per value
- **Verifier**: the same encrypted probe row, so a wrong password is rejected
  before anything is decrypted
- **Fields**: app, user, password, url, comment, favorite, color
- **Ordering**: favorites first, then alphabetical by app
- **URL handling**: bare hosts get `https://`, and scripting schemes
  (`javascript:`, `data:`, `vbscript:`, `file:`) are rejected

Rows written before `url`, `favorite`, or `color` existed still read correctly.

## Backups

**Backup** opens a save panel and writes one self-contained file wherever you
point it. Copy that file anywhere — it needs no companion files.

**Do not copy the vault file yourself.** The vault runs in SQLite's WAL mode, so
writes land in a `.db-wal` alongside it and stay there until SQLite folds them
back in, which it does at 1000 pages or on a clean close — and a personal vault
reaches neither. A copy of the `.db` on its own is usually a stub with no tables
in it, and it fails silently: nothing complains until you try to restore it.

The web app writes its backups into `data/backups/` because a server has no file
picker. Here you choose the location, which is the better answer — a backup
sitting next to the original does not survive losing the disk. Both clients name
the file identically, and `vault_repository_test.dart` asserts that they agree.

**Restore** picks a backup, confirms, replaces the vault, and locks it. The lock
is not a courtesy: the backup brings its own salt and verifier, so afterwards
the master password is the one that was in use when that backup was taken.

Restoring is undoable. The vault as it stands is backed up into `backups/` next
to the vault file before anything is replaced, and the path is shown once the
restore finishes. Picking the wrong backup costs a second restore, not the data.

Restoring runs inside SQLite as a single transaction rather than as a file copy.
Copying a backup over the vault file looks like it works and does not — any
process still holding the vault open writes its own write-ahead log over it
afterwards, and the discarded rows come back with no error shown. A backup that
is not a vault is rejected before anything is deleted.

Either client can restore a backup either one wrote.

## Tests

```bash
flutter test
```

The suite is interoperability-first. `test/fixtures/interop_vault.db` is a real
vault written by the Node implementation, and `test/fixtures/crypto_vectors.json`
holds keys and ciphertexts produced by Node. The Dart code is checked against
both — if the two implementations ever drift apart, these tests fail.

The fixtures are regenerated with the scripts in `tool/`. The Node ones run
from the repo root:

```bash
node desktop_app/tool/generate_fixtures.ts          # crypto vectors from the Node code
node desktop_app/tool/make_interop_db.ts <path>     # a vault written by the Node code
```

And the Dart ones from this folder:

```bash
dart run tool/emit_dart_vectors.dart        # the same vectors, from the Dart code
dart run tool/write_interop_entry.dart      # a row written by the Dart code
```

`tool/bench_scrypt.dart` measures key derivation on this machine — useful if the
unlock step ever starts to feel slow.

## Notes

- Clicking an entry's url opens it in the default browser. The app still opens
  no sockets of its own — the address goes to the OS, which launches the
  browser. Only `http` and `https` are handed over: anything else is copied to
  the clipboard instead, so a stored `file://` or custom scheme can never
  launch an app on click.
- The window opens maximized to the screen's visible area (`MainFlutterWindow.swift`),
  not in a macOS fullscreen Space — the vault stays one Cmd+Tab away from
  whatever you were doing when you needed a password.
- Key derivation runs on a background isolate, so the window never freezes
  during the scrypt cost of unlocking (~180ms on this machine — measure yours
  with `dart run tool/bench_scrypt.dart`).
- The master password is held in memory only while the app is unlocked. Closing
  the app, or clicking **Lock**, drops it.
- The app never talks to the network. There is nothing to configure and nothing
  to publish.
