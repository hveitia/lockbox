import 'dart:convert';
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

    for (final column in ['url', 'favorite', 'color']) {
      _addColumnIfMissing(db, 'entries', column);
    }
  }

  /// SQLite has no `ADD COLUMN IF NOT EXISTS`. New columns must be nullable:
  /// existing rows hold ciphertext and there is no key at migration time.
  static void _addColumnIfMissing(Database db, String table, String column) {
    final existing = db
        .select('PRAGMA table_info($table)')
        .map((row) => row['name'] as String)
        .toSet();

    if (existing.contains(column)) return;

    db.execute('ALTER TABLE $table ADD COLUMN $column TEXT');
  }

  ({String salt, String verifier})? _meta() {
    final rows = _db.select('SELECT salt, verifier FROM vault_meta WHERE id = 1');
    if (rows.isEmpty) return null;

    return (salt: rows.first['salt'] as String, verifier: rows.first['verifier'] as String);
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
      'INSERT INTO vault_meta (id, salt, verifier) VALUES (1, ?, ?)',
      [base64.encode(salt), VaultCrypto.createVerifier(key)],
    );
  }

  /// Returns the vault key, or null when the password does not open it.
  Uint8List? unlock(String masterPassword) {
    final meta = _meta();
    if (meta == null) return null;

    final key = VaultCrypto.deriveKey(
      masterPassword,
      Uint8List.fromList(base64.decode(meta.salt)),
    );

    return VaultCrypto.verifyKey(key, meta.verifier) ? key : null;
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

  void deleteEntry(int id) {
    _db.execute('DELETE FROM entries WHERE id = ?', [id]);

    if (_db.updatedRows == 0) {
      throw ValidationError('No entry with id $id');
    }
  }

  /// Re-encrypts every entry under a key derived from [newMasterPassword].
  /// Runs in a transaction so a failure leaves the old password working.
  Uint8List changeMasterPassword(Uint8List currentKey, String newMasterPassword) {
    if (newMasterPassword.length < minMasterPasswordLength) {
      throw const ValidationError(
        'Master password must be at least $minMasterPasswordLength characters',
      );
    }

    final entries = listEntries(currentKey);
    final salt = VaultCrypto.createSalt();
    final newKey = VaultCrypto.deriveKey(newMasterPassword, salt);

    _db.execute('BEGIN');
    try {
      _db.execute(
        'UPDATE vault_meta SET salt = ?, verifier = ? WHERE id = 1',
        [base64.encode(salt), VaultCrypto.createVerifier(newKey)],
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
}
