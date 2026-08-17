// Measures how long the vault's scrypt parameters take in pure Dart.
// The unlock screen blocks on this, so the number decides the design.
// ignore_for_file: avoid_print — this is a command line tool, not app code.
import 'dart:convert';
import 'dart:typed_data';

import 'package:pointycastle/export.dart';

void main() {
  final salt = Uint8List.fromList(List<int>.generate(16, (i) => i));
  final password = Uint8List.fromList(utf8.encode('a-strong-master-password'));

  for (final n in [16384, 32768]) {
    final derivator = Scrypt()
      ..init(ScryptParameters(n, 8, 1, 32, salt));

    final started = DateTime.now();
    final key = derivator.process(password);
    final elapsed = DateTime.now().difference(started);

    print('N=$n -> ${elapsed.inMilliseconds}ms  key=${key.length} bytes');
  }
}
