/// Facts about *where* a vault file lives.
///
/// Which file is open decides whether the master password works at all. Two
/// vaults look identical through the unlock screen — same prompt, same error —
/// so the path is not decoration, it is the thing that tells you why a correct
/// password is being rejected.
library;

import 'package:path/path.dart' as p;

/// Directories the operating system is free to erase. A vault here is a test
/// vault: it will be wiped, and its master password is not the real one.
const List<String> _temporaryRoots = [
  '/tmp',
  '/private/tmp',
  '/var/folders',
  '/private/var/folders',
];

/// True when [path] sits in a location macOS treats as scratch space.
///
/// Pointing the app at a throwaway vault is easy to do and almost impossible
/// to notice: the unlock screen looks exactly the same, and the only symptom
/// is a master password that "does not work".
bool isTemporaryLocation(String path) {
  if (path.isEmpty) return false;

  final normalized = p.normalize(path);

  return _temporaryRoots.any(
    (root) => normalized == root || p.isWithin(root, normalized),
  );
}

/// The file name on its own — what a person actually reads to tell two vaults
/// apart when both paths are long.
String vaultFileName(String path) => path.isEmpty ? '' : p.basename(path);

/// The containing folder, shown under the file name.
String vaultFolder(String path) => path.isEmpty ? '' : p.dirname(path);
