import 'package:flutter/material.dart';

/// The palette is the web app's, value for value (src/app/globals.css), so the
/// two front ends read as one product. Typography is native macOS instead of
/// the web fonts: an app that looks at home on the desktop beats one that
/// bundles megabytes of typefaces to imitate a browser.
class VaultTheme {
  const VaultTheme._();

  static const Color ink = Color(0xFF191317);
  static const Color inkRaised = Color(0xFF221A20);
  static const Color inkLine = Color(0xFF322730);
  static const Color brass = Color(0xFFC8A15A);
  static const Color brassDim = Color(0xFF8A6F3E);
  static const Color parchment = Color(0xFFEFE7DC);
  static const Color muted = Color(0xFF9A8B92);
  static const Color alarm = Color(0xFFD4553F);

  static const String displayFont = 'New York';
  static const String monoFont = 'SF Mono';

  /// Entry accent colors. Keys must match `entryColors` in data/entry.dart and
  /// the `.tone-*` rules in the web app's globals.css.
  static const Map<String, Color> accents = {
    'default': brass,
    'crimson': Color(0xFFB8443F),
    'rose': Color(0xFFD4677F),
    'orchid': Color(0xFFC069B8),
    'plum': Color(0xFF9560B5),
    'indigo': Color(0xFF6B7CCC),
    'sky': Color(0xFF4A9ED6),
    'teal': Color(0xFF3FA09A),
    'fern': Color(0xFF4FA562),
    'moss': Color(0xFF82A04A),
    'olive': Color(0xFFB0A13F),
    'amber': Color(0xFFE0A13C),
    'rust': Color(0xFFCC7038),
    'cocoa': Color(0xFF9D7C62),
    'slate': Color(0xFF8792A3),
  };

  static Color accentOf(String color) => accents[color] ?? brass;

  static ThemeData build() {
    const scheme = ColorScheme.dark(
      primary: brass,
      onPrimary: ink,
      surface: ink,
      onSurface: parchment,
      error: alarm,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: ink,
      dividerColor: inkLine,
      textSelectionTheme: const TextSelectionThemeData(
        selectionColor: brassDim,
        cursorColor: brass,
      ),
      textTheme: const TextTheme(
        displaySmall: TextStyle(
          fontFamily: displayFont,
          fontWeight: FontWeight.w600,
          color: parchment,
        ),
        titleLarge: TextStyle(
          fontFamily: displayFont,
          fontWeight: FontWeight.w600,
          fontSize: 19,
          color: parchment,
        ),
        bodyMedium: TextStyle(color: parchment, fontSize: 13.5),
        bodySmall: TextStyle(color: muted, fontSize: 12.5),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: ink,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        hintStyle: const TextStyle(color: Color(0x889A8B92), fontFamily: monoFont),
        border: _border(inkLine),
        enabledBorder: _border(inkLine),
        focusedBorder: _border(brassDim),
        errorBorder: _border(alarm),
        focusedErrorBorder: _border(alarm),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: brass,
          foregroundColor: ink,
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(2)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: muted,
          side: const BorderSide(color: inkLine),
          textStyle: const TextStyle(fontSize: 12),
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(2)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        ),
      ),
      dialogTheme: const DialogThemeData(
        backgroundColor: inkRaised,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(3)),
          side: BorderSide(color: inkLine),
        ),
      ),
      tooltipTheme: const TooltipThemeData(
        decoration: BoxDecoration(
          color: inkRaised,
          border: Border.fromBorderSide(BorderSide(color: inkLine)),
        ),
        textStyle: TextStyle(color: parchment, fontSize: 12),
      ),
    );
  }

  static OutlineInputBorder _border(Color color) => OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(2)),
        borderSide: BorderSide(color: color),
      );

  /// Small uppercase caption used above fields and in the header.
  static const TextStyle label = TextStyle(
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: muted,
    fontWeight: FontWeight.w500,
  );

  static const TextStyle mono = TextStyle(fontFamily: monoFont, fontSize: 13);
}
