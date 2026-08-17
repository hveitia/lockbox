import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/entry.dart';
import '../data/vault_repository.dart';
import '../state/vault_controller.dart';
import '../theme.dart';
import '../widgets/entry_card.dart';
import '../widgets/entry_dialog.dart';
import '../widgets/master_password_dialog.dart';

class VaultScreen extends StatefulWidget {
  const VaultScreen({super.key, required this.controller});

  final VaultController controller;

  @override
  State<VaultScreen> createState() => _VaultScreenState();
}

class _VaultScreenState extends State<VaultScreen> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _openEntryDialog({Entry? entry}) async {
    final controller = widget.controller;
    String? error;

    // Reopen with the submitted values on failure so nothing typed is lost.
    while (true) {
      if (!mounted) return;

      final input = await showDialog<EntryInput>(
        context: context,
        builder: (_) => EntryDialog(entry: entry, initialError: error),
      );

      if (input == null) return;

      if (entry == null) {
        await controller.createEntry(input);
      } else {
        await controller.updateEntry(entry.id, input);
      }

      if (controller.error == null) return;

      error = controller.error;
      controller.clearError();
      entry = _asEntry(input, entry);
    }
  }

  /// Rebuilds a draft entry from a rejected submission so the reopened dialog
  /// shows what the user typed rather than the stored values.
  Entry _asEntry(EntryInput input, Entry? original) => Entry(
        id: original?.id ?? -1,
        app: input.app,
        username: input.username,
        url: input.url,
        password: input.password,
        comment: input.comment,
        favorite: input.favorite,
        color: input.color,
        createdAt: original?.createdAt ?? '',
        updatedAt: original?.updatedAt ?? '',
      );

  /// Opens a stored url in the default browser.
  ///
  /// The app still makes no network calls of its own — the address goes to the
  /// operating system, which launches the browser. What it must not do is hand
  /// over a scheme that would launch something else, so the value is checked
  /// first and a refused link falls back to the clipboard rather than silently
  /// doing nothing.
  Future<void> _openUrl(String url) async {
    final target = launchableUri(url);

    if (target == null) {
      await _copyInstead(url, 'That link is not http or https, so it was copied instead');
      return;
    }

    final opened = await launchUrl(target, mode: LaunchMode.externalApplication);
    if (opened || !mounted) return;

    await _copyInstead(url, 'No browser would open that link, so it was copied');
  }

  Future<void> _copyInstead(String url, String message) async {
    await Clipboard.setData(ClipboardData(text: url));
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: VaultTheme.inkRaised,
        duration: const Duration(milliseconds: 2400),
      ),
    );
  }

  /// Backs the vault up to a location the user picks.
  ///
  /// The save panel prompts about replacing an existing file itself, so a path
  /// that already exists here means the user said yes — which is the only case
  /// allowed to overwrite one.
  Future<void> _backup() async {
    final location = await getSaveLocation(
      suggestedName: VaultRepository.suggestedBackupName(DateTime.now()),
      acceptedTypeGroups: const [
        XTypeGroup(label: 'Vault database', extensions: ['db']),
      ],
    );

    if (location == null) return;

    await widget.controller.backupTo(location.path, replace: true);
    if (!mounted) return;

    // An error already surfaced through the controller's banner.
    if (widget.controller.error != null) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Backed up to ${location.path}'),
        backgroundColor: VaultTheme.inkRaised,
        duration: const Duration(milliseconds: 3600),
      ),
    );
  }

  /// Replaces the vault from a backup the user picks, after confirming.
  ///
  /// Confirmation is not ceremony here: this discards everything added since
  /// the backup was taken, and there is no undo.
  Future<void> _restore() async {
    const group = XTypeGroup(label: 'Vault backup', extensions: ['db']);
    final file = await openFile(acceptedTypeGroups: const [group]);

    if (file == null || !mounted) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: VaultTheme.inkRaised,
        title: const Text('Replace the vault?'),
        content: Text(
          'Everything currently in the vault is replaced by the contents of '
          '${file.name}.\n\n'
          'The vault as it stands right now is backed up first, so this can be '
          'undone — restore that copy to come back.\n\n'
          'The backup carries its own master password: the one in use when it '
          'was taken. The vault locks afterwards so you can sign back in.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Replace'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    await widget.controller.restoreFrom(file.path);
    if (!mounted || widget.controller.error != null) return;

    // Shown over the unlock screen the restore just dropped us on. Telling
    // someone the undo exists only helps if they are told where it is.
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Restored. The vault as it was is saved at '
          '${widget.controller.safetyCopy}',
        ),
        backgroundColor: VaultTheme.inkRaised,
        duration: const Duration(seconds: 8),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final entries = controller.entries;
    final total = controller.allEntries.length;

    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.fromLTRB(28, 24, 28, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _header(context),
            const SizedBox(height: 18),
            Container(height: 1, color: VaultTheme.brass.withValues(alpha: 0.4)),
            const SizedBox(height: 18),
            _searchRow(),
            if (total > 0) ...[
              const SizedBox(height: 14),
              _filterRow(),
            ],
            const SizedBox(height: 12),
            Text(
              total == 0
                  ? 'empty'
                  : controller.isFiltering
                      ? '${entries.length} of $total stored'
                      : '$total stored',
              style: VaultTheme.mono.copyWith(fontSize: 11, color: VaultTheme.muted),
            ),
            if (controller.error != null) ...[
              const SizedBox(height: 12),
              Text(
                controller.error!,
                style: const TextStyle(color: VaultTheme.alarm, fontSize: 13),
              ),
            ],
            const SizedBox(height: 16),
            Expanded(child: _body(total, entries)),
          ],
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('LOCAL ONLY',
                  style: TextStyle(
                    fontSize: 10.5,
                    letterSpacing: 2.6,
                    color: VaultTheme.brassDim,
                    fontWeight: FontWeight.w500,
                  )),
              const SizedBox(height: 8),
              Text('Vault',
                  style: Theme.of(context)
                      .textTheme
                      .displaySmall
                      ?.copyWith(fontSize: 32, height: 1)),
            ],
          ),
        ),
        Wrap(
          spacing: 8,
          children: [
            OutlinedButton(
              onPressed: widget.controller.refresh,
              child: const Text('Reload'),
            ),
            OutlinedButton(
              onPressed: widget.controller.busy ? null : _backup,
              child: const Text('Backup'),
            ),
            OutlinedButton(
              onPressed: widget.controller.busy ? null : _restore,
              child: const Text('Restore'),
            ),
            OutlinedButton(
              onPressed: () => showDialog(
                context: context,
                builder: (_) => MasterPasswordDialog(controller: widget.controller),
              ),
              child: const Text('Master password'),
            ),
            OutlinedButton(
              onPressed: widget.controller.lock,
              child: const Text('Lock'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _searchRow() {
    return Row(
      children: [
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: SizedBox(
            width: 420,
            child: TextField(
              controller: _search,
              style: VaultTheme.mono,
              decoration: const InputDecoration(
                hintText: 'Search apps, sites, users, notes…',
              ),
              onChanged: widget.controller.setQuery,
            ),
          ),
        ),
        const SizedBox(width: 12),
        FilledButton(
          onPressed: () => _openEntryDialog(),
          child: const Text('Add credentials'),
        ),
      ],
    );
  }

  Widget _filterRow() {
    final controller = widget.controller;
    final used = controller.usedColors;

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        OutlinedButton(
          onPressed: () => controller.setFavoritesOnly(!controller.favoritesOnly),
          style: controller.favoritesOnly
              ? OutlinedButton.styleFrom(
                  foregroundColor: VaultTheme.brass,
                  side: const BorderSide(color: VaultTheme.brass),
                )
              : null,
          child: const Text('Favorites'),
        ),
        if (used.length > 1)
          for (final color in used)
            _ColorFilterChip(
              color: color,
              selected: controller.colorFilter == color,
              onTap: () => controller.setColorFilter(
                controller.colorFilter == color ? null : color,
              ),
            ),
        if (controller.isFiltering)
          OutlinedButton(
            onPressed: () {
              _search.clear();
              controller.clearFilters();
            },
            child: const Text('Clear'),
          ),
      ],
    );
  }

  Widget _body(int total, List<Entry> entries) {
    if (total == 0) {
      return const Align(
        alignment: Alignment.topLeft,
        child: Text(
          'Nothing stored yet. Add the first set of credentials and they get '
          'encrypted before they touch the disk.',
          style: TextStyle(color: VaultTheme.muted, fontSize: 13, height: 1.5),
        ),
      );
    }

    if (entries.isEmpty) {
      return const Align(
        alignment: Alignment.topLeft,
        child: Text('Nothing matches these filters.',
            style: TextStyle(color: VaultTheme.muted, fontSize: 13)),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        // Columns, not stretched rows: width becomes density instead of
        // distance between an entry's name and its buttons.
        const minCardWidth = 360.0;
        final columns = (constraints.maxWidth / minCardWidth).floor().clamp(1, 6);

        return GridView.builder(
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: 16,
            mainAxisSpacing: 16,
            mainAxisExtent: 210,
          ),
          itemCount: entries.length,
          itemBuilder: (context, index) {
            final entry = entries[index];

            return EntryCard(
              entry: entry,
              onEdit: () => _openEntryDialog(entry: entry),
              onDelete: () => widget.controller.deleteEntry(entry.id),
              onToggleFavorite: () => widget.controller.toggleFavorite(entry),
              onOpenUrl: _openUrl,
            );
          },
        );
      },
    );
  }
}

class _ColorFilterChip extends StatelessWidget {
  const _ColorFilterChip({
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
          padding: const EdgeInsets.all(6),
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
              border:
                  isDefault ? Border.all(color: VaultTheme.muted, width: 1.5) : null,
            ),
          ),
        ),
      ),
    );
  }
}
