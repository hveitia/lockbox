import 'package:flutter/material.dart';

import 'screens/gate_screen.dart';
import 'screens/locate_screen.dart';
import 'screens/vault_screen.dart';
import 'state/vault_controller.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const VaultApp());
}

class VaultApp extends StatefulWidget {
  const VaultApp({super.key});

  @override
  State<VaultApp> createState() => _VaultAppState();
}

class _VaultAppState extends State<VaultApp> {
  final VaultController _controller = VaultController();

  @override
  void initState() {
    super.initState();
    _controller.restore();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Vault',
      debugShowCheckedModeBanner: false,
      theme: VaultTheme.build(),
      home: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => Scaffold(body: _screen()),
      ),
    );
  }

  Widget _screen() {
    switch (_controller.stage) {
      case VaultStage.locating:
        return LocateScreen(controller: _controller);
      case VaultStage.needsSetup:
        return GateScreen(controller: _controller, setup: true);
      case VaultStage.locked:
        return GateScreen(controller: _controller, setup: false);
      case VaultStage.unlocked:
        return VaultScreen(controller: _controller);
    }
  }
}
