import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:vault_desktop/data/entry.dart';
import 'package:vault_desktop/data/vault_repository.dart';

const String interopMaster = 'interop-master-password';
const String interopDbPath = 'test/fixtures/interop_vault.db';

VaultRepository freshRepository() =>
    VaultRepository(sqlite3.openInMemory());

void main() {
  group('a vault built by the Node implementation', () {
    late VaultRepository repo;

    setUpAll(() {
      if (!File(interopDbPath).existsSync()) {
        fail(
          'Missing $interopDbPath. Regenerate from the repo root with:\n'
          '  node desktop_app/tool/make_interop_db.ts desktop_app/$interopDbPath',
        );
      }
    });

    setUp(() => repo = VaultRepository.open(interopDbPath));
    tearDown(() => repo.dispose());

    test('is recognised as initialized', () {
      expect(repo.isInitialized, isTrue);
    });

    test('opens with the master password Node set', () {
      expect(repo.unlock(interopMaster), isNotNull);
    });

    test('refuses a wrong master password', () {
      expect(repo.unlock('not the password'), isNull);
    });

    test('decrypts every field Node wrote', () {
      final entries = repo.listEntries(repo.unlock(interopMaster)!);
      final written = entries.firstWhere((e) => e.app == 'Node written entry');

      expect(written.username, 'admin@example.dev');
      expect(written.url, 'https://acme.dev/admin');
      expect(written.password, 's3cret from node');
      expect(written.comment, 'line one\nline two — ñ 🔐');
      expect(written.favorite, isTrue);
      expect(written.color, 'teal');
    });

    test('preserves significant whitespace in a password', () {
      final entries = repo.listEntries(repo.unlock(interopMaster)!);

      expect(
        entries.firstWhere((e) => e.app == 'Plain one').password,
        '  spaces matter  ',
      );
    });

    test('reads a row written before url/favorite/color existed', () {
      final entries = repo.listEntries(repo.unlock(interopMaster)!);
      final legacy = entries.firstWhere((e) => e.app == 'Legacy row');

      expect(legacy.url, '');
      expect(legacy.favorite, isFalse);
      expect(legacy.color, defaultColor);
    });

    test('lists favorites first, then alphabetically', () {
      final apps = repo
          .listEntries(repo.unlock(interopMaster)!)
          .map((e) => e.app)
          .toList();

      expect(apps.first, 'Node written entry', reason: 'the only favorite');
      expect(apps.sublist(1), ['Legacy row', 'Plain one']);
    });
  });

  group('round trip through a copy of the Node vault', () {
    late String path;
    late VaultRepository repo;

    setUp(() {
      // Work on a copy so the shared fixture stays pristine.
      path = '${Directory.systemTemp.createTempSync('vault').path}/copy.db';
      File(interopDbPath).copySync(path);
      repo = VaultRepository.open(path);
    });

    tearDown(() {
      repo.dispose();
      File(path).parent.deleteSync(recursive: true);
    });

    test('an entry written by Dart reads back through Dart', () {
      final key = repo.unlock(interopMaster)!;

      repo.createEntry(
        key,
        const EntryInput(
          app: 'Dart written',
          username: 'dart-user',
          url: 'dart.example.dev/panel',
          password: 'written-by-dart',
          comment: 'from the desktop app',
          favorite: true,
          color: 'plum',
        ),
      );

      final stored = repo
          .listEntries(key)
          .firstWhere((e) => e.app == 'Dart written');

      expect(stored.url, 'https://dart.example.dev/panel');
      expect(stored.password, 'written-by-dart');
      expect(stored.favorite, isTrue);
      expect(stored.color, 'plum');
    });

    test('stores every field encrypted at rest', () {
      final key = repo.unlock(interopMaster)!;
      repo.createEntry(
        key,
        const EntryInput(
          app: 'Secret app',
          username: 'secret-user',
          url: '',
          password: 'secret-pw',
          comment: 'secret-note',
          color: 'indigo',
        ),
      );
      repo.dispose();

      final raw = File(path).readAsBytesSync();
      final asText = String.fromCharCodes(raw);

      for (final secret in [
        'Secret app',
        'secret-user',
        'secret-pw',
        'secret-note',
        'indigo',
      ]) {
        expect(asText.contains(secret), isFalse, reason: '$secret leaked');
      }

      repo = VaultRepository.open(path);
    });

    test('updates an entry without disturbing its created_at', () {
      final key = repo.unlock(interopMaster)!;
      final original = repo
          .listEntries(key)
          .firstWhere((e) => e.app == 'Plain one');

      final updated = repo.updateEntry(
        key,
        original.id,
        const EntryInput(
          app: 'Renamed',
          username: 'u',
          url: '',
          password: 'p',
          comment: '',
        ),
      );

      expect(updated.createdAt, original.createdAt);
      expect(updated.app, 'Renamed');
    });

    test('toggles favorite without touching the password', () {
      final key = repo.unlock(interopMaster)!;
      final before = repo
          .listEntries(key)
          .firstWhere((e) => e.app == 'Plain one');

      repo.setFavorite(key, before.id, true);

      final after = repo.listEntries(key).firstWhere((e) => e.id == before.id);
      expect(after.favorite, isTrue);
      expect(after.password, before.password);
    });

    test('deletes an entry', () {
      final key = repo.unlock(interopMaster)!;
      final target = repo.listEntries(key).firstWhere((e) => e.app == 'Plain one');

      repo.deleteEntry(target.id);

      expect(
        repo.listEntries(key).where((e) => e.id == target.id),
        isEmpty,
      );
    });

    test('throws when deleting an unknown id', () {
      expect(() => repo.deleteEntry(9999), throwsA(isA<ValidationError>()));
    });

    test('rejects a blank app', () {
      final key = repo.unlock(interopMaster)!;

      expect(
        () => repo.createEntry(
          key,
          const EntryInput(app: '  ', username: '', url: '', password: 'p', comment: ''),
        ),
        throwsA(isA<ValidationError>()),
      );
    });

    test('rejects a scripting scheme in the url', () {
      final key = repo.unlock(interopMaster)!;

      expect(
        () => repo.createEntry(
          key,
          const EntryInput(
            app: 'App',
            username: '',
            url: 'javascript:alert(1)',
            password: 'p',
            comment: '',
          ),
        ),
        throwsA(isA<ValidationError>()),
      );
    });

    test('changing the master password re-encrypts everything', () {
      final key = repo.unlock(interopMaster)!;
      final before = repo.listEntries(key).map((e) => e.password).toList();

      repo.changeMasterPassword(key, 'a-brand-new-master');

      expect(repo.unlock(interopMaster), isNull);
      final newKey = repo.unlock('a-brand-new-master');
      expect(newKey, isNotNull);
      expect(repo.listEntries(newKey!).map((e) => e.password).toList(), before);
    });
  });

  group('a vault created by Dart', () {
    test('initializes and unlocks', () {
      final repo = freshRepository();
      addTearDown(repo.dispose);

      expect(repo.isInitialized, isFalse);
      repo.initialize('dart-made-master');

      expect(repo.isInitialized, isTrue);
      expect(repo.unlock('dart-made-master'), isNotNull);
      expect(repo.unlock('wrong'), isNull);
    });

    test('refuses a master password shorter than the minimum', () {
      final repo = freshRepository();
      addTearDown(repo.dispose);

      expect(() => repo.initialize('short'), throwsA(isA<ValidationError>()));
    });

    test('refuses to initialize twice', () {
      final repo = freshRepository();
      addTearDown(repo.dispose);
      repo.initialize('dart-made-master');

      expect(
        () => repo.initialize('another-password'),
        throwsA(isA<ValidationError>()),
      );
    });
  });

  group('url normalization matches the web app', () {
    test('assumes https for a bare host', () {
      expect(normalizeUrl('acme.dev/admin'), 'https://acme.dev/admin');
    });

    test('treats localhost:3000 as a host, not a scheme', () {
      expect(normalizeUrl('localhost:3000'), 'https://localhost:3000');
    });

    test('keeps an explicit scheme', () {
      expect(normalizeUrl('http://localhost:8080'), 'http://localhost:8080');
    });

    test('is empty for empty input', () {
      expect(normalizeUrl('   '), '');
    });

    for (final hostile in [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      test('rejects $hostile', () {
        expect(() => normalizeUrl(hostile), throwsA(isA<ValidationError>()));
      });
    }
  });

  /// Clicking a link hands a string to the operating system, which will open
  /// whatever app claims that scheme. Validating on write is not enough: rows
  /// outlive the code that wrote them, and the url column was added to an
  /// existing table, so a stored value has not necessarily been through
  /// `normalizeUrl` at all. This is the guard at the boundary being crossed.
  group('launchableUri', () {
    test('returns the address for an ordinary https url', () {
      expect(
        launchableUri('https://acme.dev/admin').toString(),
        'https://acme.dev/admin',
      );
    });

    test('allows plain http, for a box on the local network', () {
      expect(
        launchableUri('http://localhost:8080').toString(),
        'http://localhost:8080',
      );
    });

    test('assumes https for a bare host, exactly like storage does', () {
      expect(launchableUri('acme.dev').toString(), 'https://acme.dev');
    });

    test('returns null rather than throwing for an empty value', () {
      expect(launchableUri(''), isNull);
      expect(launchableUri('   '), isNull);
    });

    for (final hostile in [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ssh://root@example.dev',
      'mailto:someone@example.dev',
    ]) {
      test('refuses to hand $hostile to the OS', () {
        expect(launchableUri(hostile), isNull);
      });
    }

    test('a click never throws, whatever is in the row', () {
      for (final junk in ['://', 'http://', '   ', 'nonsense', '%%%']) {
        expect(() => launchableUri(junk), returnsNormally);
      }
    });
  });

  group('color normalization matches the web app', () {
    test('accepts every listed color', () {
      for (final color in entryColors) {
        expect(normalizeColor(color), color);
      }
    });

    test('treats empty as the default', () {
      expect(normalizeColor(''), defaultColor);
    });

    test('rejects an unlisted name', () {
      expect(() => normalizeColor('hotpink'), throwsA(isA<ValidationError>()));
    });

    test('reads an unknown stored value as the default', () {
      expect(readColor('chartreuse'), defaultColor);
      expect(readColor(null), defaultColor);
    });
  });
}
