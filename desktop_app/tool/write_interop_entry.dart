/// Writes entries into a vault using the Dart implementation, for the Node
/// test suite to read back. This is the step that proves the desktop app's
/// CRUD is safe: rows it writes must be readable by the web app.
///
/// Run from desktop_app/:  dart run tool/write_interop_entry.dart
library;

import 'dart:io';

import 'package:vault_desktop/data/entry.dart';
import 'package:vault_desktop/data/vault_repository.dart';

const String master = 'dart-written-master';

void main() {
  final target = File('../src/lib/fixtures/dart_written_vault.db');
  target.parent.createSync(recursive: true);

  for (final suffix in ['', '-wal', '-shm']) {
    final file = File('${target.path}$suffix');
    if (file.existsSync()) file.deleteSync();
  }

  final repo = VaultRepository.open(target.path);
  repo.initialize(master);
  final key = repo.unlock(master)!;

  repo.createEntry(
    key,
    const EntryInput(
      app: 'Written by Dart',
      username: 'desktop@example.dev',
      url: 'desktop.example.dev/panel',
      password: 'dart-side-secret',
      comment: 'multi\nline — ñ ü 🔐',
      favorite: true,
      color: 'orchid',
    ),
  );

  repo.createEntry(
    key,
    const EntryInput(
      app: 'Second from Dart',
      username: '',
      url: '',
      password: '  padded  ',
      comment: '',
    ),
  );

  repo.dispose();

  stdout.writeln('wrote a Dart-authored vault to ${target.path}');
}
