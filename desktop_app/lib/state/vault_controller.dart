import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/entry.dart';
import '../data/vault_repository.dart';

enum VaultStage {
  /// No vault file chosen yet, or the stored path no longer resolves.
  locating,

  /// File found but it holds no vault: offer to create one.
  needsSetup,

  /// Vault exists and is waiting for the master password.
  locked,

  /// Unlocked; entries are readable.
  unlocked,
}

/// Holds the whole app's state. The derived key lives here in memory only and
/// never touches disk — closing the app re-locks the vault, exactly like the
/// web app losing its server-side session.
class VaultController extends ChangeNotifier {
  VaultController({VaultRepository Function(String path)? openRepository})
      : _open = openRepository ?? VaultRepository.open;

  static const String _pathPreferenceKey = 'vault_db_path';

  final VaultRepository Function(String path) _open;

  VaultRepository? _repo;
  Uint8List? _key;

  VaultStage _stage = VaultStage.locating;
  String? _dbPath;
  String? _error;
  bool _busy = false;
  List<Entry> _entries = const [];

  String _query = '';
  bool _favoritesOnly = false;
  String? _colorFilter;

  VaultStage get stage => _stage;
  String? get dbPath => _dbPath;
  String? get error => _error;
  bool get busy => _busy;
  List<Entry> get allEntries => _entries;

  String get query => _query;
  bool get favoritesOnly => _favoritesOnly;
  String? get colorFilter => _colorFilter;

  bool get isFiltering =>
      _query.trim().isNotEmpty || _favoritesOnly || _colorFilter != null;

  List<Entry> get entries {
    final needle = _query.trim().toLowerCase();

    return _entries
        .where((entry) =>
            (needle.isEmpty || entry.matches(needle)) &&
            (!_favoritesOnly || entry.favorite) &&
            (_colorFilter == null || entry.color == _colorFilter))
        .toList();
  }

  /// Colors that at least one entry uses — filtering by anything else would
  /// always come back empty.
  List<String> get usedColors {
    final used = _entries.map((e) => e.color).toSet();

    return entryColors.where(used.contains).toList();
  }

  /// Restores the previously chosen vault file, if it still opens.
  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_pathPreferenceKey);

    if (saved == null) {
      _stage = VaultStage.locating;
      notifyListeners();
      return;
    }

    await openVault(saved, remember: false);
  }

  /// Points the app at a vault file and remembers it for next launch.
  Future<void> openVault(String path, {bool remember = true}) async {
    _busy = true;
    _error = null;
    notifyListeners();

    try {
      _repo?.dispose();
      _repo = _open(path);
      _dbPath = path;
      _stage = _repo!.isInitialized ? VaultStage.locked : VaultStage.needsSetup;

      if (remember) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_pathPreferenceKey, path);
      }
    } catch (error) {
      _repo = null;
      _dbPath = null;
      _stage = VaultStage.locating;
      _error = 'Could not open that file: $error';
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  /// Forgets the current file and returns to the locate screen.
  Future<void> forgetVault() async {
    lock();
    _repo?.dispose();
    _repo = null;
    _dbPath = null;
    _stage = VaultStage.locating;
    _error = null;

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_pathPreferenceKey);

    notifyListeners();
  }

  Future<void> createVault(String masterPassword, String confirmation) async {
    if (masterPassword != confirmation) {
      _fail('The two master passwords do not match');
      return;
    }

    await _guard(() async {
      _repo!.initialize(masterPassword);
      _key = _repo!.unlock(masterPassword);
      _stage = VaultStage.unlocked;
      _reload();
    });
  }

  Future<void> unlock(String masterPassword) async {
    await _guard(() async {
      // Deriving the key is deliberately slow; keep it off the UI thread so
      // the window does not freeze while it runs.
      final key = await compute(
        _deriveOnIsolate,
        (_dbPath!, masterPassword),
      );

      if (key == null) {
        throw const ValidationError('Wrong master password');
      }

      _key = key;
      _stage = VaultStage.unlocked;
      _reload();
    });
  }

  void lock() {
    _key = null;
    _entries = const [];
    _query = '';
    _favoritesOnly = false;
    _colorFilter = null;
    if (_stage == VaultStage.unlocked) _stage = VaultStage.locked;
    notifyListeners();
  }

  Future<void> createEntry(EntryInput input) =>
      _guard(() async => _repo!.createEntry(_key!, input));

  Future<void> updateEntry(int id, EntryInput input) =>
      _guard(() async => _repo!.updateEntry(_key!, id, input));

  Future<void> deleteEntry(int id) =>
      _guard(() async => _repo!.deleteEntry(id));

  Future<void> toggleFavorite(Entry entry) =>
      _guard(() async => _repo!.setFavorite(_key!, entry.id, !entry.favorite));

  /// Backs the vault up to [destinationPath], replacing it if [replace] is set.
  ///
  /// SQLite refuses to write over an existing file. [replace] is how the save
  /// dialog's own "a file named X already exists — replace it?" answer reaches
  /// down here: the user has already consented at that point, so the file is
  /// removed first. Nothing else should pass it.
  Future<void> backupTo(String destinationPath, {bool replace = false}) =>
      _guard(() async {
        final existing = File(destinationPath);
        if (replace && existing.existsSync()) existing.deleteSync();

        _repo!.backupTo(destinationPath);
      });

  /// Replaces the vault's contents with a backup, then locks.
  ///
  /// Locking is not a courtesy. The backup brings its own salt and verifier, so
  /// the key held in memory decrypts nothing afterwards — leaving it in place
  /// would show a list of decryption failures instead of a password prompt.
  /// Clearing it also stops [_guard] from reloading entries it cannot read.
  Future<void> restoreFrom(String backupPath) => _guard(() async {
        _repo!.restoreFrom(backupPath);
        lock();
      });

  Future<void> changeMasterPassword(String next, String confirmation) async {
    if (next != confirmation) {
      _fail('The two new master passwords do not match');
      return;
    }

    await _guard(() async {
      _key = _repo!.changeMasterPassword(_key!, next);
    });
  }

  /// Re-reads from disk. The web app may have written to the same file.
  void refresh() {
    if (_key == null) return;

    try {
      _reload();
      _error = null;
    } catch (error) {
      _error = _messageOf(error);
    }
    notifyListeners();
  }

  void setQuery(String value) {
    _query = value;
    notifyListeners();
  }

  void setFavoritesOnly(bool value) {
    _favoritesOnly = value;
    notifyListeners();
  }

  void setColorFilter(String? value) {
    _colorFilter = value;
    notifyListeners();
  }

  void clearFilters() {
    _query = '';
    _favoritesOnly = false;
    _colorFilter = null;
    notifyListeners();
  }

  void clearError() {
    if (_error == null) return;
    _error = null;
    notifyListeners();
  }

  void _reload() {
    _entries = _repo!.listEntries(_key!);
    // A filtered-out color may no longer exist after an edit.
    if (_colorFilter != null && !usedColors.contains(_colorFilter)) {
      _colorFilter = null;
    }
  }

  void _fail(String message) {
    _error = message;
    notifyListeners();
  }

  /// Runs a mutating action, refreshes the list, and turns any failure into a
  /// message the UI can show instead of an unhandled exception.
  Future<void> _guard(Future<void> Function() action) async {
    _busy = true;
    _error = null;
    notifyListeners();

    try {
      await action();
      if (_key != null) _reload();
    } catch (error) {
      _error = _messageOf(error);
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  String _messageOf(Object error) =>
      error is ValidationError ? error.message : error.toString();

  @override
  void dispose() {
    _repo?.dispose();
    super.dispose();
  }
}

/// Runs on a background isolate: opening the file there avoids sharing a
/// database handle across isolates, which sqlite3 does not allow.
Uint8List? _deriveOnIsolate((String, String) args) {
  final (path, masterPassword) = args;
  final repo = VaultRepository.open(path);

  try {
    return repo.unlock(masterPassword);
  } finally {
    repo.dispose();
  }
}
