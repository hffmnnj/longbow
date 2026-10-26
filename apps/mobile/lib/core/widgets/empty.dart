import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme/theme.dart';

/// Empty state: icon, one-line [title], optional [message] and [action]
/// (usually a FilledButton or TextButton).
class Empty extends StatelessWidget {
  const Empty({super.key, required this.title, this.icon = LbIcons.searching, this.message, this.action});

  final String title;
  final IconData icon;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final t = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            LbIcon(icon, size: 28, color: c.mutedForeground),
            const SizedBox(height: 12),
            Text(title, style: t.titleMedium, textAlign: TextAlign.center),
            if (message != null) ...[
              const SizedBox(height: 4),
              Text(message!, style: LbText.muted(context), textAlign: TextAlign.center),
            ],
            if (action != null) ...[const SizedBox(height: 16), action!],
          ],
        ),
      ),
    );
  }
}
