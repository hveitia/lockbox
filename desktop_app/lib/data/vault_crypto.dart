import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:pointycastle/export.dart';
import 'package:unorm_dart/unorm_dart.dart' show nfkc;

import 'entry.dart';

/// Dart mirror of `src/lib/crypto.ts`.
///
/// Every parameter here — scrypt cost, key length, IV size, tag size, and the
/// `iv | tag | ciphertext` payload layout — must match the Node implementation
/// exactly, or the two apps cannot read each other's rows.
/// `test/vault_crypto_test.dart` checks that against vectors Node produced.
class VaultCrypto {
  const VaultCrypto._();

  static const int keyBytes = 32;
  static const int saltBytes = 16;
  static const int ivBytes = 12;
  static const int tagBytes = 16;

  /// scrypt cost parameters, by version. Mirrors `KDF_PARAMETERS` in
  /// `src/lib/crypto.ts` and must not drift from it.
  ///
  /// The salt is stored in the vault but these are not, which is why the table
  /// is versioned: a key needs both to be reproduced, so a vault records which
  /// row built it. Change these without recording a version and every existing
  /// vault stops opening, indistinguishably from a wrong password.
  ///
  /// Never edit an existing row — a vault out there was written with it. Add a
  /// row and move [currentKdfVersion].
  static const Map<int, ({int n, int r, int p})> _kdfParameters = {
    1: (n: 32768, r: 8, p: 1),
    2: (n: 131072, r: 8, p: 1),
  };

  /// What new vaults are written with.
  static const int currentKdfVersion = 1;

  /// What a missing `kdf_version` means. Vaults written before the column
  /// existed were all built with version 1, so that is what NULL decodes to.
  /// This must never change.
  static const int legacyKdfVersion = 1;

  static const String _verifierPlaintext = 'vault-key-verifier-v1';

  static final Random _random = Random.secure();

  static Uint8List _randomBytes(int length) {
    return Uint8List.fromList(
      List<int>.generate(length, (_) => _random.nextInt(256)),
    );
  }

  static Uint8List createSalt() => _randomBytes(saltBytes);

  /// Derives the vault key from the master password. Intentionally slow
  /// (~200ms), which is the point — it is what makes the file expensive to
  /// brute force offline.
  static Uint8List deriveKey(
    String masterPassword,
    Uint8List salt, [
    int version = currentKdfVersion,
  ]) {
    final parameters = _kdfParameters[version];
    if (parameters == null) {
      throw ValidationError(
        'This vault was written with key derivation version $version, which '
        'this build does not know about. Use a newer version of the app.',
      );
    }

    // NFKC first, to match Node's `masterPassword.normalize('NFKC')`. This is
    // not cosmetic: macOS hands apps decomposed accents through several input
    // paths, so "contraseña" can arrive as n + U+0303 here and as a single
    // U+00F1 in the browser. Hashing the raw bytes derives a different key
    // from the same typed password, and the only symptom is an unlock that
    // keeps saying the master password is wrong.
    final password = Uint8List.fromList(utf8.encode(nfkc(masterPassword)));

    final derivator = Scrypt()
      ..init(ScryptParameters(
        parameters.n,
        parameters.r,
        parameters.p,
        keyBytes,
        salt,
      ));

    return derivator.process(password);
  }

  /// Encrypts to a base64 payload laid out as iv | authTag | ciphertext.
  static String encrypt(String plaintext, Uint8List key) {
    final iv = _randomBytes(ivBytes);
    final cipher = GCMBlockCipher(AESEngine())
      ..init(
        true,
        AEADParameters(KeyParameter(key), tagBytes * 8, iv, Uint8List(0)),
      );

    // PointyCastle appends the tag to the ciphertext; Node keeps it separate
    // and puts it in front, so the two halves get swapped here.
    final sealed = cipher.process(Uint8List.fromList(utf8.encode(plaintext)));
    final ciphertext = sealed.sublist(0, sealed.length - tagBytes);
    final tag = sealed.sublist(sealed.length - tagBytes);

    return base64.encode(
      Uint8List.fromList([...iv, ...tag, ...ciphertext]),
    );
  }

  /// Decrypts a payload produced by [encrypt] or by the Node implementation.
  /// Throws if the key is wrong or the data was tampered with.
  static String decrypt(String payload, Uint8List key) {
    final raw = base64.decode(payload);

    if (raw.length < ivBytes + tagBytes) {
      throw ArgumentError('Ciphertext is too short to be valid');
    }

    final iv = Uint8List.sublistView(raw, 0, ivBytes);
    final tag = Uint8List.sublistView(raw, ivBytes, ivBytes + tagBytes);
    final ciphertext = Uint8List.sublistView(raw, ivBytes + tagBytes);

    final cipher = GCMBlockCipher(AESEngine())
      ..init(
        false,
        AEADParameters(KeyParameter(key), tagBytes * 8, iv, Uint8List(0)),
      );

    // Reassemble in PointyCastle's order: ciphertext followed by the tag.
    final sealed = Uint8List.fromList([...ciphertext, ...tag]);

    return utf8.decode(cipher.process(sealed));
  }

  /// Builds the token stored in the vault so a master password can be checked.
  static String createVerifier(Uint8List key) => encrypt(_verifierPlaintext, key);

  /// Returns true when [key] is the key [verifier] was created with.
  static bool verifyKey(Uint8List key, String verifier) {
    try {
      return decrypt(verifier, key) == _verifierPlaintext;
    } catch (_) {
      return false;
    }
  }
}
