import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme/theme.dart';

/// Error state with a human [message] and a Retry button when [onRetry] is set.
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry, this.title = 'Something went wrong'});

  final String title;
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
        child: Semantics(
          liveRegion: true,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              LbIcon(LbIcons.alertCircle, size: 28, color: c.destructive),
              const SizedBox(height: 12),
              Text(title, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
              const SizedBox(height: 4),
              Text(message, style: LbText.muted(context), textAlign: TextAlign.center),
              if (onRetry != null) ...[
                const SizedBox(height: 16),
                OutlinedButton.icon(onPressed: onRetry, icon: const LbIcon(LbIcons.refresh, size: 18), label: const Text('Retry')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
