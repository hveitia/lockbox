import 'package:flutter/material.dart';

import '../theme.dart';

/// The narrow centred column shared by the locate, setup and unlock screens.
/// Deliberately not full width: a single password field stretched across a
/// desktop window helps nobody.
class GateShell extends StatelessWidget {
  const GateShell({
    super.key,
    required this.heading,
    required this.children,
    this.note,
    this.error,
    this.footer,
  });

  final String heading;
  final List<Widget> children;
  final String? note;
  final String? error;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
        child: SizedBox(
          width: 360,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('LOCAL ONLY',
                  style: TextStyle(
                    fontSize: 10.5,
                    letterSpacing: 2.6,
                    color: VaultTheme.brassDim,
                    fontWeight: FontWeight.w500,
                  )),
              const SizedBox(height: 12),
              Text(
                heading,
                style: Theme.of(context).textTheme.displaySmall?.copyWith(fontSize: 30),
              ),
              const SizedBox(height: 20),
              Container(height: 1, color: VaultTheme.brass.withValues(alpha: 0.4)),
              const SizedBox(height: 24),
              ...children,
              if (error != null) ...[
                const SizedBox(height: 16),
                Text(
                  error!,
                  style: const TextStyle(color: VaultTheme.alarm, fontSize: 13),
                ),
              ],
              if (note != null) ...[
                const SizedBox(height: 22),
                Text(
                  note!,
                  style: const TextStyle(
                    color: VaultTheme.muted,
                    fontSize: 12,
                    height: 1.5,
                  ),
                ),
              ],
              if (footer != null) ...[const SizedBox(height: 26), footer!],
            ],
          ),
        ),
      ),
    );
  }
}
