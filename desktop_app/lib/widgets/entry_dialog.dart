import 'package:flutter/material.dart';

import '../data/entry.dart';
import '../theme.dart';

/// Add or edit a credential. Returns the submitted input, or null on cancel;
/// the caller decides what to do with it and surfaces any validation error.
class EntryDialog extends StatefulWidget {
  const EntryDialog({super.key, this.entry, this.initialError});

  final Entry? entry;
  final String? initialError;

  @override
  State<EntryDialog> createState() => _EntryDialogState();
}

class _EntryDialogState extends State<EntryDialog> {
  late final TextEditingController _app;
  late final TextEditingController _url;
  late final TextEditingController _username;
  late final TextEditingController _password;
  late final TextEditingController _comment;

  late String _color;
  late bool _favorite;

  @override
  void initState() {
    super.initState();
    final entry = widget.entry;

    _app = TextEditingController(text: entry?.app ?? '');
    _url = TextEditingController(text: entry?.url ?? '');
    _username = TextEditingController(text: entry?.username ?? '');
    _password = TextEditingController(text: entry?.password ?? '');
    _comment = TextEditingController(text: entry?.comment ?? '');
    _color = entry?.color ?? defaultColor;
    _favorite = entry?.favorite ?? false;
  }

  @override
  void dispose() {
    for (final c in [_app, _url, _username, _password, _comment]) {
      c.dispose();
    }
    super.dispose();
  }

  void _submit() {
    Navigator.of(context).pop(
      EntryInput(
        app: _app.text,
        username: _username.text,
        url: _url.text,
        password: _password.text,
        comment: _comment.text,
        favorite: _favorite,
        color: _color,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.entry != null;

    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                editing ? 'Edit credentials' : 'Add credentials',
                style: Theme.of(context).textTheme.displaySmall?.copyWith(fontSize: 22),
              ),
              const SizedBox(height: 6),
              Container(height: 1, color: VaultTheme.brass.withValues(alpha: 0.4)),
              const SizedBox(height: 20),
              _field('APP', _app, hint: 'Acme dashboard', autofocus: true),
              _field('URL', _url, hint: 'acme.dev/admin'),
              _field('USER', _username, hint: 'admin'),
              _field('PASSWORD', _password),
              _field('NOTE', _comment,
                  hint: 'Staging only — rotate before launch', lines: 3),
              const Text('COLOR', style: VaultTheme.label),
              const SizedBox(height: 8),
              _colorPicker(),
              const SizedBox(height: 18),
              _favoriteToggle(),
              if (widget.initialError != null) ...[
                const SizedBox(height: 16),
                Text(
                  widget.initialError!,
                  style: const TextStyle(color: VaultTheme.alarm, fontSize: 13),
                ),
              ],
              const SizedBox(height: 22),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: 10),
                  FilledButton(
                    onPressed: _submit,
                    child: Text(editing ? 'Save changes' : 'Add to vault'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(
    String label,
    TextEditingController controller, {
    String? hint,
    int lines = 1,
    bool autofocus = false,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: VaultTheme.label),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            autofocus: autofocus,
            maxLines: lines,
            style: VaultTheme.mono,
            decoration: InputDecoration(hintText: hint),
            onSubmitted: lines == 1 ? (_) => _submit() : null,
          ),
        ],
      ),
    );
  }

  Widget _colorPicker() {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final color in entryColors)
          _Swatch(
            color: color,
            selected: _color == color,
            onTap: () => setState(() => _color = color),
          ),
      ],
    );
  }

  Widget _favoriteToggle() {
    return InkWell(
      onTap: () => setState(() => _favorite = !_favorite),
      child: Row(
        children: [
          Checkbox(
            value: _favorite,
            onChanged: (value) => setState(() => _favorite = value ?? false),
            activeColor: VaultTheme.brass,
            checkColor: VaultTheme.ink,
            side: const BorderSide(color: VaultTheme.inkLine),
          ),
          const SizedBox(width: 4),
          const Text('Pin to the top as a favorite',
              style: TextStyle(fontSize: 13, color: VaultTheme.parchment)),
        ],
      ),
    );
  }
}

/// A color choice. "default" means no color, so it renders as a hollow ring —
/// a filled brass dot reads as a deliberate pick and sits too close to amber.
class _Swatch extends StatelessWidget {
  const _Swatch({
    required this.color,
    required this.selected,
    required this.onTap,
  });

  final String color;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = VaultTheme.accentOf(color);
    final isDefault = color == defaultColor;

    return Tooltip(
      message: isDefault ? 'No color' : color,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(3),
        child: Container(
          padding: const EdgeInsets.all(7),
          decoration: BoxDecoration(
            border: Border.all(color: selected ? accent : VaultTheme.inkLine),
            color: selected ? accent.withValues(alpha: 0.16) : null,
            borderRadius: BorderRadius.circular(3),
          ),
          child: Container(
            width: 15,
            height: 15,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isDefault ? null : accent,
              border: isDefault
                  ? Border.all(color: VaultTheme.muted, width: 1.5)
                  : null,
            ),
          ),
        ),
      ),
    );
  }
}
