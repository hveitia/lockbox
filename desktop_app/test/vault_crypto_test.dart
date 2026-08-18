import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:vault_desktop/data/vault_crypto.dart';

/// These vectors were produced by the Node implementation in src/lib/crypto.ts.
/// Reproducing them exactly is the only thing keeping the two crypto
/// implementations interoperable — a silent divergence would mean the desktop
/// app writes rows the web app cannot read.
Map<String, dynamic> loadFixtures() {
  final file = File('test/fixtures/crypto_vectors.json');

  if (!file.existsSync()) {
    fail(
      'Missing test/fixtures/crypto_vectors.json. '
      'Regenerate with: node desktop_app/tool/generate_fixtures.ts',
    );
  }

  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

Uint8List hexToBytes(String hex) {
  return Uint8List.fromList([
    for (var i = 0; i < hex.length; i += 2)
      int.parse(hex.substring(i, i + 2), radix: 16),
  ]);
}

String bytesToHex(Uint8List bytes) {
  return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
}

void main() {
  final fixtures = loadFixtures();

  group('deriveKey', () {
    test('matches the key Node derives from the same password and salt', () {
      final spec = fixtures['scrypt'] as Map<String, dynamic>;

      final key = VaultCrypto.deriveKey(
        spec['password'] as String,
        hexToBytes(spec['saltHex'] as String),
      );

      expect(bytesToHex(key), spec['expectedKeyHex']);
    });

    test('matches Node for a second password and a random salt', () {
      final spec = fixtures['scryptSecondary'] as Map<String, dynamic>;

      final key = VaultCrypto.deriveKey(
        spec['password'] as String,
        hexToBytes(spec['saltHex'] as String),
      );

      expect(bytesToHex(key), spec['expectedKeyHex']);
    });

    /// Both clients must agree at every version in the table, not only at
    /// whichever one is current. A version whose parameters drift on one side
    /// would otherwise lock that side out of vaults the other wrote — silently,
    /// and only for the people who had already created a vault.
    for (final spec
        in (fixtures['kdfVersions'] as List).cast<Map<String, dynamic>>()) {
      test('matches Node at kdf version ${spec['version']}', () {
        final key = VaultCrypto.deriveKey(
          spec['password'] as String,
          hexToBytes(spec['saltHex'] as String),
          spec['version'] as int,
        );

        expect(bytesToHex(key), spec['expectedKeyHex']);
      });
    }

    test('defaults to the version new vaults are written with', () {
      final spec = fixtures['scrypt'] as Map<String, dynamic>;

      expect(spec['kdfVersion'], VaultCrypto.currentKdfVersion);
    });

    test('returns 32 bytes', () {
      expect(VaultCrypto.deriveKey('whatever', Uint8List(16)).length, 32);
    });

    test('a different password gives a different key', () {
      final salt = Uint8List(16);

      expect(
        bytesToHex(VaultCrypto.deriveKey('one', salt)),
        isNot(bytesToHex(VaultCrypto.deriveKey('two', salt))),
      );
    });
  });

  /// Node normalizes the master password to NFKC before hashing it. A client
  /// that hashes the raw bytes instead derives a different key from the same
  /// typed password, and unlocking a vault the other client created fails with
  /// nothing more than "wrong master password" to go on. macOS hands apps
  /// decomposed accents through several input paths, so typing "contraseña"
  /// is enough to reach this.
  group('deriveKey normalizes like Node', () {
    final cases = (fixtures['normalization'] as List).cast<Map<String, dynamic>>();

    for (final spec in cases) {
      test('${spec['label']}', () {
        final password = spec['password'] as String;

        // Guard the fixture itself: if the JSON ever gets re-saved with the
        // accents composed, the case would still pass while testing nothing.
        expect(
          password.runes.toList(),
          (spec['codePoints'] as List).cast<int>(),
          reason: 'fixture code points were mangled in transit',
        );

        final key = VaultCrypto.deriveKey(
          password,
          hexToBytes(spec['saltHex'] as String),
        );

        expect(bytesToHex(key), spec['expectedKeyHex']);
      });
    }

    test('the same password composed or decomposed unlocks the same vault', () {
      final salt = hexToBytes(cases.first['saltHex'] as String);
      final decomposed = VaultCrypto.deriveKey('contrasen\u0303a', salt);
      final composed = VaultCrypto.deriveKey('contrase\u00f1a', salt);

      expect(bytesToHex(decomposed), bytesToHex(composed));
    });

    test('a verifier written for one form accepts the other', () {
      final salt = hexToBytes(cases.first['saltHex'] as String);
      final verifier = VaultCrypto.createVerifier(
        VaultCrypto.deriveKey('contrasen\u0303a', salt),
      );

      expect(
        VaultCrypto.verifyKey(
          VaultCrypto.deriveKey('contrase\u00f1a', salt),
          verifier,
        ),
        isTrue,
      );
    });
  });

  group('decrypt', () {
    late Uint8List key;

    setUp(() {
      final spec = fixtures['scrypt'] as Map<String, dynamic>;
      key = VaultCrypto.deriveKey(
        spec['password'] as String,
        hexToBytes(spec['saltHex'] as String),
      );
    });

    for (final vector in (fixtures['vectors'] as List)) {
      final plaintext = vector['plaintext'] as String;
      final label = plaintext.isEmpty
          ? '(empty string)'
          : plaintext.length > 24
              ? '${plaintext.substring(0, 24)}…'
              : plaintext;

      test('reads what Node encrypted: $label', () {
        expect(
          VaultCrypto.decrypt(vector['payloadBase64'] as String, key),
          plaintext,
        );
      });
    }

    test('throws when the key is wrong', () {
      final vector = (fixtures['vectors'] as List)[1];
      final wrongKey = hexToBytes(
        (fixtures['verifier'] as Map)['wrongKeyHex'] as String,
      );

      expect(
        () => VaultCrypto.decrypt(vector['payloadBase64'] as String, wrongKey),
        throwsA(anything),
      );
    });

    test('throws when the ciphertext was tampered with', () {
      final vector = (fixtures['vectors'] as List)[1];
      final raw = base64.decode(vector['payloadBase64'] as String);
      raw[raw.length - 1] ^= 0xff;

      expect(
        () => VaultCrypto.decrypt(base64.encode(raw), key),
        throwsA(anything),
      );
    });

    test('throws when the payload is too short to hold iv and tag', () {
      expect(
        () => VaultCrypto.decrypt(base64.encode(Uint8List(4)), key),
        throwsA(anything),
      );
    });
  });

  group('encrypt', () {
    late Uint8List key;

    setUp(() {
      final spec = fixtures['scrypt'] as Map<String, dynamic>;
      key = VaultCrypto.deriveKey(
        spec['password'] as String,
        hexToBytes(spec['saltHex'] as String),
      );
    });

    test('round trips through our own decrypt', () {
      const text = 'a brand new secret — ñ 🔐';

      expect(VaultCrypto.decrypt(VaultCrypto.encrypt(text, key), key), text);
    });

    test('round trips an empty string', () {
      expect(VaultCrypto.decrypt(VaultCrypto.encrypt('', key), key), '');
    });

    test('uses a fresh iv every time', () {
      expect(
        VaultCrypto.encrypt('same', key),
        isNot(VaultCrypto.encrypt('same', key)),
      );
    });

    test('lays out the payload as iv | tag | ciphertext, like Node', () {
      final raw = base64.decode(VaultCrypto.encrypt('abc', key));

      // 12 byte iv + 16 byte tag + 3 bytes of ciphertext.
      expect(raw.length, 12 + 16 + 3);
    });
  });

  group('verifier', () {
    test('accepts the key it was created with', () {
      final spec = fixtures['scrypt'] as Map<String, dynamic>;
      final key = VaultCrypto.deriveKey(
        spec['password'] as String,
        hexToBytes(spec['saltHex'] as String),
      );

      expect(
        VaultCrypto.verifyKey(
          key,
          (fixtures['verifier'] as Map)['payloadBase64'] as String,
        ),
        isTrue,
      );
    });

    test('rejects a key derived from another password', () {
      final wrongKey = hexToBytes(
        (fixtures['verifier'] as Map)['wrongKeyHex'] as String,
      );

      expect(
        VaultCrypto.verifyKey(
          wrongKey,
          (fixtures['verifier'] as Map)['payloadBase64'] as String,
        ),
        isFalse,
      );
    });

    test('rejects a malformed verifier instead of throwing', () {
      expect(VaultCrypto.verifyKey(Uint8List(32), 'not-base64!!'), isFalse);
    });

    test('a verifier we create is accepted by our own check', () {
      final key = VaultCrypto.deriveKey('fresh master', Uint8List(16));

      expect(VaultCrypto.verifyKey(key, VaultCrypto.createVerifier(key)), isTrue);
    });
  });
}
