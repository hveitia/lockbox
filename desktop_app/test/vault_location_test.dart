import 'package:flutter_test/flutter_test.dart';
import 'package:vault_desktop/data/vault_location.dart';

void main() {
  group('isTemporaryLocation', () {
    // The case this exists for: the app remembered a throwaway vault created
    // during development, and every unlock attempt with the real master
    // password failed with nothing on screen to explain why.
    test('flags a scratch vault under /private/tmp', () {
      expect(
        isTemporaryLocation('/private/tmp/claude-501/x/scratchpad/vault.db'),
        isTrue,
      );
    });

    test('flags /tmp', () {
      expect(isTemporaryLocation('/tmp/vault.db'), isTrue);
    });

    test('flags the macOS per-user temp area', () {
      expect(isTemporaryLocation('/var/folders/ab/cd/T/vault.db'), isTrue);
    });

    test('leaves a real project vault alone', () {
      expect(
        isTemporaryLocation('/Users/hector/Documents/Work/vault/data/vault.db'),
        isFalse,
      );
    });

    test('is not fooled by a folder that merely starts with the same letters', () {
      expect(isTemporaryLocation('/tmpvault/vault.db'), isFalse);
    });

    test('resolves traversal before deciding', () {
      expect(isTemporaryLocation('/tmp/../Users/hector/vault.db'), isFalse);
    });

    test('is false for an empty path', () {
      expect(isTemporaryLocation(''), isFalse);
    });
  });

  group('path parts', () {
    test('splits a vault path into name and folder', () {
      const path = '/Users/hector/Documents/Work/vault/data/vault.db';

      expect(vaultFileName(path), 'vault.db');
      expect(vaultFolder(path), '/Users/hector/Documents/Work/vault/data');
    });

    test('handles an empty path', () {
      expect(vaultFileName(''), '');
      expect(vaultFolder(''), '');
    });
  });
}
