import 'package:flutter/material.dart';

import '../data/entry.dart';
import '../state/vault_controller.dart';
import '../theme.dart';

class MasterPasswordDialog extends StatefulWidget {
  const MasterPasswordDialog({super.key, required this.controller});

  final VaultController controller;

  @override
  State<MasterPasswordDialog> createState() => _MasterPasswordDialogState();
}

class _MasterPasswordDialogState extends State<MasterPasswordDialog> {
  final _next = TextEditingController();
  final _confirmation = TextEditingController();
  String? _error;
  bool _working = false;

  @override
  void dispose() {
    _next.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _working = true;
      _error = null;
    });

    await widget.controller.changeMasterPassword(_next.text, _confirmation.text);

    if (!mounted) return;

    final error = widget.controller.error;
    if (error == null) {
      Navigator.of(context).pop();
      return;
    }

    widget.controller.clearError();
    setState(() {
      _working = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Change master password',
                  style: Theme.of(context)
                      .textTheme
                      .displaySmall
                      ?.copyWith(fontSize: 22)),
              const SizedBox(height: 6),
              Container(height: 1, color: VaultTheme.brass.withValues(alpha: 0.4)),
              const SizedBox(height: 18),
              const Text(
                'Every stored password gets re-encrypted under the new one, and '
                'the web app will ask for it too — it is the same vault.',
                style: TextStyle(color: VaultTheme.muted, fontSize: 12.5, height: 1.5),
              ),
              const SizedBox(height: 18),
              const Text('NEW MASTER PASSWORD', style: VaultTheme.label),
              const SizedBox(height: 6),
              TextField(
                controller: _next,
                obscureText: true,
                autofocus: true,
                style: VaultTheme.mono,
              ),
              const SizedBox(height: 16),
              const Text('TYPE IT AGAIN', style: VaultTheme.label),
              const SizedBox(height: 6),
              TextField(
                controller: _confirmation,
                obscureText: true,
                style: VaultTheme.mono,
                onSubmitted: (_) => _submit(),
              ),
              if (_error != null) ...[
                const SizedBox(height: 16),
                Text(_error!,
                    style: const TextStyle(color: VaultTheme.alarm, fontSize: 13)),
              ],
              const SizedBox(height: 10),
              Text(
                'At least $minMasterPasswordLength characters. There is no recovery.',
                style: const TextStyle(color: VaultTheme.muted, fontSize: 11.5),
              ),
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
                    onPressed: _working ? null : _submit,
                    child: Text(_working ? 'Re-encrypting…' : 'Change it'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
