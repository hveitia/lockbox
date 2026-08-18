import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:sqlite3/sqlite3.dart';

import 'entry.dart';
import 'vault_crypto.dart';

/// Dart mirror of `src/lib/vault.ts`, reading and writing the same SQLite file
/// the web app uses. Schema, column names, and the encrypted-at-rest layout
/// must match exactly.
class VaultRepository {
  VaultRepository(this._db) {
    // The web app may hold the same file open. WAL supports that across
    // processes; the timeout keeps a concurrent write from failing instantly
    // with SQLITE_BUSY.
    _db.execute('PRAGMA busy_timeout = 5000');
    migrate(_db);
  }

  factory VaultRepository.open(String path) =>
      VaultRepository(sqlite3.open(path));

  final Database _db;

  void dispose() => _db.close();

  static void migrate(Database db) {
    db.execute('''
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS vault_meta (
        id       INTEGER PRIMARY KEY CHECK (id = 1),
        salt     TEXT NOT NULL,
        verifier TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        app        TEXT NOT NULL,
        username   TEXT NOT NULL,
        password   TEXT NOT NULL,
        comment    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    ''');

    // Records which row of the scrypt parameter table built this vault's key.
    // NULL means "written before this column existed", which is version 1.
    _addColumnIfMissing(db, 'vault_meta', 'kdf_version', type: 'INTEGER');

    for (final column in ['url', 'favorite', 'color']) {
      _addColumnIfMissing(db, 'entries', column);
    }
  }

  /// SQLite has no `ADD COLUMN IF NOT EXISTS`. New columns must be nullable:
  /// existing rows hold ciphertext and there is no key at migration time.
  ///
  /// [type] must match what `addColumnIfMissing` passes in `src/lib/vault.ts`
  /// for the same column. SQLite gives a column type affinity rather than a
  /// strict type, so declaring one TEXT here and INTEGER there does not fail —
  /// it silently stores '1' in one client and 1 in the other, and the mismatch
  /// only surfaces as a cast error on whichever side reads the other's vault.
  static void _addColumnIfMissing(
    Database db,
    String table,
    String column, {
    String type = 'TEXT',
  }) {
    final existing = db
        .select('PRAGMA table_info($table)')
        .map((row) => row['name'] as String)
        .toSet();

    if (existing.contains(column)) return;

    db.execute('ALTER TABLE $table ADD COLUMN $column $type');
  }

  ({String salt, String verifier, int kdfVersion})? _meta() {
    final rows = _db.select(
      'SELECT salt, verifier, kdf_version FROM vault_meta WHERE id = 1',
    );
    if (rows.isEmpty) return null;

    return (
      salt: rows.first['salt'] as String,
      verifier: rows.first['verifier'] as String,
      // Read defensively rather than cast: type affinity means this can come
      // back as an int or as a String depending on how the column was declared
      // by whichever client created it.
      kdfVersion: switch (rows.first['kdf_version']) {
        final int v => v,
        final String v => int.tryParse(v) ?? VaultCrypto.legacyKdfVersion,
        _ => VaultCrypto.legacyKdfVersion,
      },
    );
  }

  bool get isInitialized => _meta() != null;

  /// Sets the master password for a brand new vault.
  void initialize(String masterPassword) {
    if (isInitialized) {
      throw const ValidationError('Vault is already initialized');
    }
    if (masterPassword.length < minMasterPasswordLength) {
      throw const ValidationError(
        'Master password must be at least $minMasterPasswordLength characters',
      );
    }

    final salt = VaultCrypto.createSalt();
    final key = VaultCrypto.deriveKey(masterPassword, salt);

    _db.execute(
      'INSERT INTO vault_meta (id, salt, verifier, kdf_version) '
      'VALUES (1, ?, ?, ?)',
      [
        base64.encode(salt),
        VaultCrypto.createVerifier(key),
        VaultCrypto.currentKdfVersion,
      ],
    );
  }

  /// Returns the vault key, or null when the password does not open it.
  Uint8List? unlock(String masterPassword) {
    final meta = _meta();
    if (meta == null) return null;

    // The version the vault recorded, never the current one: an old vault must
    // keep opening after the parameters move on.
    final key = VaultCrypto.deriveKey(
      masterPassword,
      Uint8List.fromList(base64.decode(meta.salt)),
      meta.kdfVersion,
    );

    if (!VaultCrypto.verifyKey(key, meta.verifier)) return null;
    if (meta.kdfVersion >= VaultCrypto.currentKdfVersion) return key;

    // Unlocking is the only moment the plaintext password is in hand, so it is
    // the only place the key can be re-derived at stronger parameters. Without
    // this a vault created before the raise stays on the old cost forever, and
    // raising it buys its owner nothing.
    //
    // The length check is deliberately skipped: this password already opens the
    // vault, and refusing it because a minimum has risen since would lock
    // someone out of their own data.
    try {
      return _reEncryptUnder(key, masterPassword);
    } catch (_) {
      // A vault that cannot be rewritten — read-only media, a busy writer —
      // must still open. The upgrade is an improvement, not a precondition.
      return key;
    }
  }

  /// Reads a column added after the fact; NULL means "written before it existed".
  String _decryptAdded(Object? value, Uint8List key) {
    if (value == null) return '';

    return VaultCrypto.decrypt(value as String, key);
  }

  Entry _decryptRow(Row row, Uint8List key) {
    return Entry(
      id: row['id'] as int,
      app: VaultCrypto.decrypt(row['app'] as String, key),
      username: VaultCrypto.decrypt(row['username'] as String, key),
      url: _decryptAdded(row['url'], key),
      password: VaultCrypto.decrypt(row['password'] as String, key),
      comment: VaultCrypto.decrypt(row['comment'] as String, key),
      favorite: _decryptAdded(row['favorite'], key) == 'true',
      color: readColor(_decryptAdded(row['color'], key)),
      createdAt: row['created_at'] as String,
      updatedAt: row['updated_at'] as String,
    );
  }

  /// Every field is encrypted, so sorting cannot happen in SQL. Favorites
  /// first, then alphabetical — same order the web app shows.
  List<Entry> listEntries(Uint8List key) {
    final entries = _db
        .select('SELECT * FROM entries')
        .map((row) => _decryptRow(row, key))
        .toList();

    entries.sort((a, b) {
      if (a.favorite != b.favorite) return a.favorite ? -1 : 1;

      return a.app.toLowerCase().compareTo(b.app.toLowerCase());
    });

    return entries;
  }

  EntryInput _normalize(EntryInput input) {
    final app = input.app.trim();
    if (app.isEmpty) throw const ValidationError('App is required');
    // Passwords are stored verbatim: leading/trailing spaces can be significant.
    if (input.password.isEmpty) throw const ValidationError('Password is required');

    return EntryInput(
      app: app,
      username: input.username.trim(),
      url: normalizeUrl(input.url),
      password: input.password,
      comment: input.comment.trim(),
      favorite: input.favorite,
      color: normalizeColor(input.color),
    );
  }

  List<Object?> _encryptedFields(EntryInput entry, Uint8List key) => [
        VaultCrypto.encrypt(entry.app, key),
        VaultCrypto.encrypt(entry.username, key),
        VaultCrypto.encrypt(entry.url, key),
        VaultCrypto.encrypt(entry.password, key),
        VaultCrypto.encrypt(entry.comment, key),
        VaultCrypto.encrypt(entry.favorite.toString(), key),
        VaultCrypto.encrypt(entry.color, key),
      ];

  Entry createEntry(Uint8List key, EntryInput input) {
    final entry = _normalize(input);
    final now = DateTime.now().toUtc().toIso8601String();

    _db.execute(
      '''INSERT INTO entries
           (app, username, url, password, comment, favorite, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
      [..._encryptedFields(entry, key), now, now],
    );

    return Entry(
      id: _db.lastInsertRowId,
      app: entry.app,
      username: entry.username,
      url: entry.url,
      password: entry.password,
      comment: entry.comment,
      favorite: entry.favorite,
      color: entry.color,
      createdAt: now,
      updatedAt: now,
    );
  }

  Entry updateEntry(Uint8List key, int id, EntryInput input) {
    final entry = _normalize(input);

    final existing = _db.select('SELECT created_at FROM entries WHERE id = ?', [id]);
    if (existing.isEmpty) {
      throw ValidationError('No entry with id $id');
    }

    final now = DateTime.now().toUtc().toIso8601String();

    _db.execute(
      '''UPDATE entries
            SET app = ?, username = ?, url = ?, password = ?, comment = ?,
                favorite = ?, color = ?, updated_at = ?
          WHERE id = ?''',
      [..._encryptedFields(entry, key), now, id],
    );

    return Entry(
      id: id,
      app: entry.app,
      username: entry.username,
      url: entry.url,
      password: entry.password,
      comment: entry.comment,
      favorite: entry.favorite,
      color: entry.color,
      createdAt: existing.first['created_at'] as String,
      updatedAt: now,
    );
  }

  /// Flips just the favorite flag, so the star never rewrites a password.
  void setFavorite(Uint8List key, int id, bool favorite) {
    _db.execute(
      'UPDATE entries SET favorite = ?, updated_at = ? WHERE id = ?',
      [
        VaultCrypto.encrypt(favorite.toString(), key),
        DateTime.now().toUtc().toIso8601String(),
        id,
      ],
    );

    if (_db.updatedRows == 0) {
      throw ValidationError('No entry with id $id');
    }
  }

  /// Writes a self-contained copy of the vault to [destinationPath].
  ///
  /// Copying the vault file with the filesystem does not work, and fails
  /// silently: the vault runs in WAL mode, SQLite only folds the write-ahead
  /// log back into the main file at 1000 pages or on a clean close, and a
  /// personal vault hits neither — so the file on disk is a stub whose tables
  /// have not been written yet. `VACUUM INTO` builds one consistent file from
  /// the database plus its log without pausing writers.
  ///
  /// Throws if [destinationPath] already exists; SQLite will not clobber it.
  /// Callers that have the user's consent to replace a file must delete it
  /// first — see the save-dialog flow in the vault screen.
  void backupTo(String destinationPath) {
    final statement = _db.prepare('VACUUM INTO ?');
    try {
      statement.execute([destinationPath]);
    } finally {
      statement.close();
    }
  }

  /// Column names a table actually has.
  ///
  /// The schema goes before the pragma, not on the table: `PRAGMA x.table_info(t)`
  /// reaches an attached database, `table_info(x.t)` is a syntax error.
  List<String> _columnsOf(String table, {String schema = 'main'}) => _db
      .select('PRAGMA $schema.table_info($table)')
      .map((row) => row['name'] as String)
      .toList();

  /// Backs the vault up into [directory] under a timestamped name, creating
  /// the directory if needed, and returns the path written.
  ///
  /// Mirrors `createBackup` in `src/lib/vault.ts`. [now] is injectable so the
  /// name is testable; nothing else should pass it.
  String createBackupIn(String directory, {DateTime? now}) {
    Directory(directory).createSync(recursive: true);

    final destination =
        '$directory/${suggestedBackupName(now ?? DateTime.now())}';
    backupTo(destination);

    return destination;
  }

  /// Throws unless [candidatePath] is a readable SQLite file shaped like a
  /// vault. Restoring destroys what is already there, so a bad source has to be
  /// rejected before anything is deleted rather than halfway through.
  static void assertRestorable(String candidatePath) {
    if (!File(candidatePath).existsSync()) {
      throw ValidationError('There is no file at $candidatePath');
    }

    late final Database candidate;
    try {
      candidate = sqlite3.open(candidatePath, mode: OpenMode.readOnly);
    } on SqliteException {
      throw const ValidationError('That file is not a database');
    }

    try {
      final List<String> tables;
      try {
        // Opening is lazy; reading the schema is what touches the file, so a
        // text file named .db only fails here.
        tables = candidate
            .select("SELECT name FROM sqlite_master WHERE type = 'table'")
            .map((row) => row['name'] as String)
            .toList();
      } on SqliteException {
        throw const ValidationError('That file is not a database');
      }

      for (final required in ['vault_meta', 'entries']) {
        if (!tables.contains(required)) {
          throw const ValidationError('That file is not a vault backup');
        }
      }

      final count = candidate.select('SELECT count(*) AS n FROM vault_meta');
      if (count.first['n'] != 1) {
        throw const ValidationError(
          'That backup has no master password recorded',
        );
      }
    } finally {
      candidate.close();
    }
  }

  /// Replaces this vault's contents with those of the vault at [backupPath].
  ///
  /// Deliberately not a file copy. Overwriting the vault file from outside is a
  /// silent corruption trap: any process still holding it open checkpoints its
  /// write-ahead log over the restored file afterwards, so the discarded rows
  /// come back with no error shown. Doing it as SQL in one transaction sidesteps
  /// that — SQLite's locking handles other readers, and a failure rolls back to
  /// the vault as it was.
  ///
  /// The backup's `vault_meta` comes across too, so the vault ends up on the
  /// master password the backup was taken under. Callers must drop any key they
  /// hold afterwards; it no longer opens anything.
  void restoreFrom(String backupPath) {
    assertRestorable(backupPath);

    _db.execute('ATTACH DATABASE ? AS restore_source', [backupPath]);
    try {
      // A backup taken before url/favorite/color existed simply has fewer
      // columns; the missing ones stay NULL, which _decryptAdded already reads
      // as "written before this existed".
      final inBackup = _columnsOf('entries', schema: 'restore_source');
      final shared = _columnsOf('entries').where(inBackup.contains).join(', ');

      _db.execute('BEGIN IMMEDIATE');
      try {
        _db.execute('DELETE FROM entries');
        _db.execute('DELETE FROM vault_meta');
        // Carried across like any other column. A backup taken before
        // kdf_version existed does not have it, and the NULL that leaves
        // behind decodes to version 1 — which is what such a backup was built
        // with. Losing this would make a restored vault unopenable.
        final inBackupMeta = _columnsOf('vault_meta', schema: 'restore_source');
        final metaColumns = _columnsOf('vault_meta')
            .where(inBackupMeta.contains)
            .join(', ');

        _db.execute(
          'INSERT INTO vault_meta ($metaColumns) '
          'SELECT $metaColumns FROM restore_source.vault_meta',
        );
        _db.execute(
          'INSERT INTO entries ($shared) '
          'SELECT $shared FROM restore_source.entries',
        );
        _db.execute('COMMIT');
      } catch (_) {
        _db.execute('ROLLBACK');
        rethrow;
      }
    } finally {
      _db.execute('DETACH DATABASE restore_source');
    }
  }

  /// Default filename offered by the save dialog.
  ///
  /// Deliberately identical to the name `createBackup` writes in
  /// `src/lib/vault.ts`: both clients back up the same vault, and they must
  /// not disagree about what a backup is called. Colons are legal on macOS but
  /// Finder renders them as slashes and FAT32 rejects them, so the timestamp
  /// carries dashes only. Milliseconds stay in because [backupTo] refuses to
  /// overwrite.
  static String suggestedBackupName(DateTime now) {
    final stamp = now
        .toUtc()
        .toIso8601String()
        .replaceAll(RegExp(r'[:.]'), '-')
        .replaceAll(RegExp(r'Z$'), '');

    return 'vault-$stamp.db';
  }

  void deleteEntry(int id) {
    _db.execute('DELETE FROM entries WHERE id = ?', [id]);

    if (_db.updatedRows == 0) {
      throw ValidationError('No entry with id $id');
    }
  }

  /// Re-encrypts every entry under a key derived from [newMasterPassword].
  /// Runs in a transaction so a failure leaves the old password working.
  /// Re-encrypts every entry under a key derived from [masterPassword], at the
  /// current KDF version. Runs in a transaction so a failure leaves the vault
  /// exactly as it was, still opening with the old key.
  ///
  /// Shared by changing the master password and by upgrading key derivation:
  /// both are the same operation, and the second is the first with the password
  /// left unchanged.
  Uint8List _reEncryptUnder(Uint8List currentKey, String masterPassword) {
    final entries = listEntries(currentKey);
    final salt = VaultCrypto.createSalt();
    final newKey = VaultCrypto.deriveKey(masterPassword, salt);

    _db.execute('BEGIN');
    try {
      _db.execute(
        // Re-stamped with the current version, not the one the vault had. This
        // is also the upgrade path: re-encrypting under a new key is exactly
        // what moving to stronger parameters requires.
        'UPDATE vault_meta SET salt = ?, verifier = ?, kdf_version = ? '
        'WHERE id = 1',
        [
          base64.encode(salt),
          VaultCrypto.createVerifier(newKey),
          VaultCrypto.currentKdfVersion,
        ],
      );

      for (final entry in entries) {
        _db.execute(
          '''UPDATE entries
                SET app = ?, username = ?, url = ?, password = ?, comment = ?,
                    favorite = ?, color = ?
              WHERE id = ?''',
          [..._encryptedFields(EntryInput.from(entry), newKey), entry.id],
        );
      }

      _db.execute('COMMIT');
    } catch (_) {
      _db.execute('ROLLBACK');
      rethrow;
    }

    return newKey;
  }

  /// Re-encrypts every entry under a new master password.
  /// Runs in a transaction so a failure leaves the old password working.
  Uint8List changeMasterPassword(Uint8List currentKey, String newMasterPassword) {
    if (newMasterPassword.length < minMasterPasswordLength) {
      throw const ValidationError(
        'Master password must be at least $minMasterPasswordLength characters',
      );
    }

    return _reEncryptUnder(currentKey, newMasterPassword);
  }
}
