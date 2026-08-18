// Measures how long the vault's scrypt parameters take in pure Dart.
// The unlock screen blocks on this, so the number decides the design.
// ignore_for_file: avoid_print — this is a command line tool, not app code.
import 'dart:convert';
import 'dart:typed_data';

import 'package:pointycastle/export.dart';

void main() {
  final salt = Uint8List.fromList(List<int>.generate(16, (i) => i));
  final password = Uint8List.fromList(utf8.encode('a-strong-master-password'));

  // Every version the vault can be written with, so this keeps measuring the
  // right thing after the parameters move. Version 1 is what older vaults are
  // still opened at; version 2 is what new ones use.
  for (final version in [1, 2]) {
    final parameters = {
      1: (n: 32768, r: 8, p: 1),
      2: (n: 131072, r: 8, p: 1),
    }[version]!;

    final derivator = Scrypt()
      ..init(ScryptParameters(
        parameters.n,
        parameters.r,
        parameters.p,
        32,
        salt,
      ));

    final started = DateTime.now();
    final key = derivator.process(password);
    final elapsed = DateTime.now().difference(started);

    print('kdf version $version (N=${parameters.n}) -> '
        '${elapsed.inMilliseconds}ms  key=${key.length} bytes');
  }
}
