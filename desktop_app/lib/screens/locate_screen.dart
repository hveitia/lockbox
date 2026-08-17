import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../state/vault_controller.dart';
import '../theme.dart';
import '../widgets/gate_shell.dart';

/// First run: point the app at the vault file the web app uses.
class LocateScreen extends StatelessWidget {
  const LocateScreen({super.key, required this.controller});

  final VaultController controller;

  Future<void> _pick(BuildContext context) async {
    const group = XTypeGroup(label: 'Vault database', extensions: ['db']);
    final file = await openFile(acceptedTypeGroups: const [group]);

    if (file != null) {
      await controller.openVault(file.path);
    }
  }

  @override
  Widget build(BuildContext context) {
    return GateShell(
      heading: 'Find your vault',
      note:
          'Pick the vault.db the web app uses — it lives in the data folder of '
          'the vault project. Both apps read and write the same file, so an '
          'entry added here shows up there.',
      children: [
        FilledButton(
          onPressed: controller.busy ? null : () => _pick(context),
          child: const Text('Choose vault.db…'),
        ),
        const SizedBox(height: 14),
        const Text(
          'Nothing is copied. The app remembers this path for next time and '
          'opens the file in place.',
          style: TextStyle(color: VaultTheme.muted, fontSize: 12, height: 1.5),
        ),
      ],
    );
  }
}
