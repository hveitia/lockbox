import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/entry.dart';
import '../theme.dart';

/// One credential. Same anatomy as the web card: title with a favorite star,
/// link and user, note, and the password on an accent band pinned to the
/// bottom so the copy button sits in the same place on every card.
class EntryCard extends StatefulWidget {
  const EntryCard({
    super.key,
    required this.entry,
    required this.onEdit,
    required this.onDelete,
    required this.onToggleFavorite,
    required this.onOpenUrl,
  });

  final Entry entry;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onToggleFavorite;
  final ValueChanged<String> onOpenUrl;

  @override
  State<EntryCard> createState() => _EntryCardState();
}

class _EntryCardState extends State<EntryCard> {
  bool _revealed = false;
  bool _confirmingDelete = false;
  String? _copied;

  static String _displayUrl(String url) => url
      .replaceFirst(RegExp(r'^https?://'), '')
      .replaceFirst(RegExp(r'/$'), '');

  Future<void> _copy(String field, String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;

    setState(() => _copied = field);
    await Future<void>.delayed(const Duration(milliseconds: 1400));
    if (mounted && _copied == field) setState(() => _copied = null);
  }

  @override
  Widget build(BuildContext context) {
    final entry = widget.entry;
    final accent = VaultTheme.accentOf(entry.color);

    return Container(
      decoration: const BoxDecoration(
        color: VaultTheme.inkRaised,
        border: Border.fromBorderSide(BorderSide(color: VaultTheme.inkLine)),
        borderRadius: BorderRadius.all(Radius.circular(3)),
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _header(context, accent)),
              const SizedBox(width: 10),
              _actions(),
            ],
          ),
          if (entry.comment.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              entry.comment,
              style: const TextStyle(
                color: VaultTheme.muted,
                fontSize: 12.5,
                height: 1.45,
              ),
            ),
          ],
          const Spacer(),
          const SizedBox(height: 16),
          _passwordBand(accent),
          if (_confirmingDelete) ...[
            const SizedBox(height: 12),
            _deleteConfirmation(),
          ],
        ],
      ),
    );
  }

  Widget _header(BuildContext context, Color accent) {
    final entry = widget.entry;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Tooltip(
              message: entry.favorite ? 'Remove from favorites' : 'Add to favorites',
              child: InkWell(
                onTap: widget.onToggleFavorite,
                borderRadius: BorderRadius.circular(4),
                child: Padding(
                  padding: const EdgeInsets.only(right: 8, top: 2, bottom: 2),
                  child: Icon(
                    entry.favorite ? Icons.star_rounded : Icons.star_outline_rounded,
                    size: 20,
                    color: entry.favorite ? accent : VaultTheme.inkLine,
                  ),
                ),
              ),
            ),
            Expanded(
              child: Text(
                entry.app,
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(left: 28, top: 2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (entry.url.isNotEmpty)
                Tooltip(
                  message: entry.url,
                  child: InkWell(
                    onTap: () => widget.onOpenUrl(entry.url),
                    child: Text(
                      _displayUrl(entry.url),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: VaultTheme.mono.copyWith(
                        color: accent,
                        decoration: TextDecoration.underline,
                        decorationColor: accent.withValues(alpha: 0.5),
                      ),
                    ),
                  ),
                ),
              if (entry.username.isNotEmpty)
                Tooltip(
                  message: 'Copy ${entry.username}',
                  child: InkWell(
                    onTap: () => _copy('username', entry.username),
                    child: Text(
                      _copied == 'username' ? 'Copied user' : entry.username,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: VaultTheme.mono.copyWith(color: VaultTheme.muted),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _actions() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        OutlinedButton(onPressed: widget.onEdit, child: const Text('Edit')),
        const SizedBox(width: 6),
        OutlinedButton(
          onPressed: () => setState(() => _confirmingDelete = true),
          child: const Text('Delete'),
        ),
      ],
    );
  }

  Widget _passwordBand(Color accent) {
    final struck = _copied == 'password';

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: struck ? 0.4 : 0.1),
        border: Border(left: BorderSide(color: accent, width: 2)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              _revealed ? widget.entry.password : '•' * 14,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: VaultTheme.mono,
            ),
          ),
          OutlinedButton(
            onPressed: () => setState(() => _revealed = !_revealed),
            child: Text(_revealed ? 'Hide' : 'Reveal'),
          ),
          const SizedBox(width: 6),
          OutlinedButton(
            onPressed: () => _copy('password', widget.entry.password),
            child: Text(struck ? 'Copied' : 'Copy'),
          ),
        ],
      ),
    );
  }

  Widget _deleteConfirmation() {
    return Wrap(
      spacing: 10,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(
          'Delete ${widget.entry.app} for good?',
          style: const TextStyle(color: VaultTheme.alarm, fontSize: 12.5),
        ),
        OutlinedButton(
          onPressed: () {
            setState(() => _confirmingDelete = false);
            widget.onDelete();
          },
          style: OutlinedButton.styleFrom(
            foregroundColor: VaultTheme.alarm,
            side: const BorderSide(color: VaultTheme.alarm),
          ),
          child: const Text('Yes, delete'),
        ),
        OutlinedButton(
          onPressed: () => setState(() => _confirmingDelete = false),
          child: const Text('Keep it'),
        ),
      ],
    );
  }
}
