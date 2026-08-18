# Security

This is a password vault, so it is worth being precise about what it defends
against and what it does not.

## Reporting a vulnerability

Please report privately, not in a public issue.

Use **Security → Report a vulnerability** on this repository, which opens a
private advisory only the maintainer can see. If that is unavailable, open a
public issue asking for a private channel — without any detail — and you will
get one.

Include what you need to make the problem concrete: the version or commit, the
steps, and what an attacker gains. A proof of concept helps, but a clear
description of the mechanism is worth more than a script.

Expect a first reply within a week. This is a personal project maintained in
spare time; there is no bounty and no SLA, and pretending otherwise would be
dishonest.

Please do not test against anyone else's vault. This software only ever runs on
its user's own machine, so there is no shared system to test on and no reason to
touch someone else's data.

## Supported versions

The latest commit on `main`. There are no releases and no backports.

## What this is

A single-user vault that runs on your own machine. The web app binds to
`127.0.0.1`; the desktop app is a native client over the same file. Neither
makes any network request — verified by inspection, and there is no HTTP client
in either codebase.

Every field of every entry — app, URL, user, password, note, favourite, colour —
is encrypted with AES-256-GCM under a key derived from your master password with
scrypt (N=2^15, r=8, p=1) over a random per-vault salt. The master password is
never stored. The derived key exists only in process memory and is gone when the
process exits.

## What it protects against

- **Someone reading the vault file.** A stolen laptop, a backup on a sync
  service, a discarded disk. The file holds no plaintext — not even which apps
  you have accounts with.
- **Tampering with the vault file.** GCM is authenticated; a modified ciphertext
  fails to decrypt rather than yielding altered data.
- **A wrong master password.** Rejected by an encrypted verifier before anything
  else is decrypted.
- **Other machines on your network.** Both `dev` and `start` bind to loopback.

## What it does not protect against

These are design boundaries, not bugs. Reports about them will be closed as
working-as-intended.

- **Malware already running as your user.** It can read the key out of process
  memory while the vault is unlocked, or log the master password as you type it.
  Nothing running in userspace can defend against this, and this does not try.
- **Anyone with your master password.** There is no second factor.
- **A forgotten master password.** There is no recovery and no backdoor. Lose it
  and the entries are unreadable — that is the design working.
- **Exposure to a network.** Do not put this behind a public hostname or a
  reverse proxy. It has no rate limiting, no account lockout, and no audit log,
  because it is not built to face anything but localhost.
- **Other local users on a shared machine.** File permissions are whatever your
  operating system gives a file in your home directory.

## Known weaknesses

Already known, so they do not need reporting. They are written down here rather
than left for someone to discover.

- **scrypt runs at N=2^15**, below the N=2^17 that OWASP currently gives as a
  minimum. It slows an offline attack on a stolen vault file by less than it
  should. A strong master password matters more than this parameter, but the
  parameter should still move. The blocker for moving it is gone — the vault now
  records which parameter set built its key, so raising the cost no longer
  strands vaults that already exist — but the raise itself has not happened yet.
- **The minimum master password is 8 characters**, which is short for the one
  secret everything else depends on. Use a passphrase.
- **The macOS app runs without the App Sandbox**, so that it can open a vault
  file anywhere you point it and reopen it on the next launch. It is built from
  source by whoever runs it.
- **Search and sort happen in memory** after decrypting every row, because
  encrypted fields cannot be indexed. Fine for a personal vault; not a design
  that scales.

## Cryptography

No custom cryptography. The web app uses Node's `node:crypto`; the desktop app
uses PointyCastle. The two are pinned to each other by test vectors — see
`src/lib/interop.test.ts` and `desktop_app/test/vault_crypto_test.dart` — so
neither implementation can drift into being subtly different from the other.

If you find a flaw in how these are used, that is exactly the kind of report
this document is asking for.
