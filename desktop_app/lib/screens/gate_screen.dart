import 'package:flutter/material.dart';

import '../data/entry.dart';
import '../data/vault_location.dart';
import '../state/vault_controller.dart';
import '../theme.dart';
import '../widgets/gate_shell.dart';

/// Setup and unlock. One screen, because they differ only in the copy and in
/// whether a confirmation field is present.
class GateScreen extends StatefulWidget {
  const GateScreen({super.key, required this.controller, required this.setup});

  final VaultController controller;
  final bool setup;

  @override
  State<GateScreen> createState() => _GateScreenState();
}

class _GateScreenState extends State<GateScreen> {
  final _password = TextEditingController();
  final _confirmation = TextEditingController();

  @override
  void dispose() {
    _password.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (widget.controller.busy) return;

    if (widget.setup) {
      await widget.controller.createVault(_password.text, _confirmation.text);
    } else {
      await widget.controller.unlock(_password.text);
    }

    if (widget.controller.error != null) {
      _password.clear();
      _confirmation.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final setup = widget.setup;

    return GateShell(
      heading: setup ? 'Set a master password' : 'Unlock the vault',
      error: controller.error,
      note: setup
          ? 'This unlocks everything. There is no recovery — at least '
              '$minMasterPasswordLength characters, and keep it somewhere you trust.'
          : 'The vault re-locks when you quit the app or press Lock.',
      footer: _VaultPathFooter(controller: controller),
      children: [
        const Text('MASTER PASSWORD', style: VaultTheme.label),
        const SizedBox(height: 6),
        TextField(
          controller: _password,
          obscureText: true,
          autofocus: true,
          style: VaultTheme.mono,
          onSubmitted: (_) => _submit(),
        ),
        if (setup) ...[
          const SizedBox(height: 16),
          const Text('TYPE IT AGAIN', style: VaultTheme.label),
          const SizedBox(height: 6),
          TextField(
            controller: _confirmation,
            obscureText: true,
            style: VaultTheme.mono,
            onSubmitted: (_) => _submit(),
          ),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: controller.busy ? null : _submit,
          child: Text(
            controller.busy
                ? 'Working…'
                : setup
                    ? 'Create vault'
                    : 'Unlock',
          ),
        ),
      ],
    );
  }
}

class _VaultPathFooter extends StatelessWidget {
  const _VaultPathFooter({required this.controller});

  final VaultController controller;

  @override
  Widget build(BuildContext context) {
    final path = controller.dbPath ?? '';
    final temporary = isTemporaryLocation(path);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Which file is open decides whether the master password works, so it
        // is readable rather than a faint caption. Unlocking the wrong vault
        // looks exactly like typing the wrong password.
        Text(
          vaultFileName(path),
          style: const TextStyle(
            fontFamily: VaultTheme.monoFont,
            fontSize: 13,
            color: VaultTheme.parchment,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          vaultFolder(path),
          style: const TextStyle(
            fontFamily: VaultTheme.monoFont,
            fontSize: 11,
            color: VaultTheme.muted,
          ),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        if (temporary) ...[
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.warning_amber_rounded,
                  size: 15, color: VaultTheme.alarm),
              const SizedBox(width: 6),
              const Expanded(
                child: Text(
                  'This is a temporary folder. It is almost certainly a test '
                  'vault, not yours — your master password will not open it.',
                  style: TextStyle(
                    color: VaultTheme.alarm,
                    fontSize: 11.5,
                    height: 1.4,
                  ),
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton(
            onPressed: controller.forgetVault,
            child: const Text('Use a different file'),
          ),
        ),
      ],
    );
  }
}
