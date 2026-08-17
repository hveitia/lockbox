/// Dart mirror of `src/lib/entry.ts`. The color names and the URL rules must
/// stay identical in both apps — they share one database file.
library;

const int minMasterPasswordLength = 8;

/// Only the NAME is stored. Order matches ENTRY_COLORS in src/lib/entry.ts.
/// NEVER rename or remove one: stored rows reference these names.
const List<String> entryColors = [
  'default',
  'crimson',
  'rose',
  'orchid',
  'plum',
  'indigo',
  'sky',
  'teal',
  'fern',
  'moss',
  'olive',
  'amber',
  'rust',
  'cocoa',
  'slate',
];

const String defaultColor = 'default';

class Entry {
  const Entry({
    required this.id,
    required this.app,
    required this.username,
    required this.url,
    required this.password,
    required this.comment,
    required this.favorite,
    required this.color,
    required this.createdAt,
    required this.updatedAt,
  });

  final int id;
  final String app;
  final String username;
  final String url;
  final String password;
  final String comment;
  final bool favorite;
  final String color;
  final String createdAt;
  final String updatedAt;

  Entry copyWith({bool? favorite}) => Entry(
        id: id,
        app: app,
        username: username,
        url: url,
        password: password,
        comment: comment,
        favorite: favorite ?? this.favorite,
        color: color,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );

  bool matches(String needle) {
    final haystack = '$app $username $url $comment'.toLowerCase();

    return haystack.contains(needle);
  }
}

/// What the forms submit, before validation.
class EntryInput {
  const EntryInput({
    required this.app,
    required this.username,
    required this.url,
    required this.password,
    required this.comment,
    this.favorite = false,
    this.color = defaultColor,
  });

  factory EntryInput.from(Entry entry) => EntryInput(
        app: entry.app,
        username: entry.username,
        url: entry.url,
        password: entry.password,
        comment: entry.comment,
        favorite: entry.favorite,
        color: entry.color,
      );

  final String app;
  final String username;
  final String url;
  final String password;
  final String comment;
  final bool favorite;
  final String color;
}

/// Raised when a submitted entry cannot be stored as-is.
class ValidationError implements Exception {
  const ValidationError(this.message);

  final String message;

  @override
  String toString() => message;
}

const Set<String> _allowedUrlSchemes = {'http', 'https'};

final RegExp _schemeWithSlashes = RegExp(r'^[a-z][a-z0-9+.-]*://', caseSensitive: false);
final RegExp _bareScheme = RegExp(r'^[a-z][a-z0-9+.-]*:', caseSensitive: false);

/// A colon followed by digits is a port — "localhost:3000" is a host, not a scheme.
final RegExp _hostWithPort = RegExp(r'^[^:/?#\s]+:\d+($|[/?#])');

bool _hasScheme(String value) {
  if (_schemeWithSlashes.hasMatch(value)) return true;

  return _bareScheme.hasMatch(value) && !_hostWithPort.hasMatch(value);
}

/// Normalizes a site address for storage. A bare host gets https, and anything
/// that is not http(s) is refused — the value is rendered as a clickable link.
String normalizeUrl(String input) {
  final trimmed = input.trim();
  if (trimmed.isEmpty) return '';

  final candidate = _hasScheme(trimmed) ? trimmed : 'https://$trimmed';

  final Uri parsed;
  try {
    parsed = Uri.parse(candidate);
  } on FormatException {
    throw ValidationError('"$trimmed" is not a valid URL');
  }

  if (!_allowedUrlSchemes.contains(parsed.scheme.toLowerCase())) {
    throw ValidationError('URL must start with http:// or https://');
  }

  if (parsed.host.isEmpty) {
    throw ValidationError('"$trimmed" is not a valid URL');
  }

  return candidate;
}

/// The address to hand the operating system for a stored url, or null when the
/// value must not be opened.
///
/// Deliberately built on [normalizeUrl] rather than repeating its rules, so the
/// launch guard cannot drift away from the storage guard. Opening a link is the
/// one place this app gives a string to something outside itself — macOS will
/// launch whichever app claims the scheme — and rows outlive the code that
/// wrote them: the url column was added to a table that already had entries, so
/// a stored value has not necessarily been validated at all.
///
/// Returns null instead of throwing, because a click is not the place to
/// surface a [ValidationError].
Uri? launchableUri(String stored) {
  try {
    final normalized = normalizeUrl(stored);
    if (normalized.isEmpty) return null;

    return Uri.parse(normalized);
  } on ValidationError {
    return null;
  } on FormatException {
    return null;
  }
}

/// Validates a submitted color. Strict: an unknown name is a bug or tampering.
String normalizeColor(String input) {
  final trimmed = input.trim();
  if (trimmed.isEmpty) return defaultColor;

  if (!entryColors.contains(trimmed)) {
    throw ValidationError('"$trimmed" is not one of the available colors');
  }

  return trimmed;
}

/// Reads a stored color. Forgiving: an old or unknown value still renders.
String readColor(String? stored) {
  if (stored == null || !entryColors.contains(stored)) return defaultColor;

  return stored;
}
