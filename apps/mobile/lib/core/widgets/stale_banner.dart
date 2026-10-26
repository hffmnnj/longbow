import 'package:flutter/material.dart';

import '../format.dart';
import '../icons.dart';
import '../theme/theme.dart';

/// Amber strip shown above data that is offline or out of date:
/// "Offline · updated 4m ago". Stale data stays visible beneath it.
class StaleBanner extends StatelessWidget {
  const StaleBanner({super.key, this.offline = true, this.updatedAtMs, this.now, this.onRetry, this.message});

  /// True for "Offline", false for "Showing saved data".
  final bool offline;

  /// Epoch ms of the last good update.
  final int? updatedAtMs;

  /// Epoch ms treated as the current time (tests); defaults to the clock.
  final int? now;
  final VoidCallback? onRetry;

  /// Replaces the generated text.
  final String? message;

  String get text {
    if (message != null) return message!;
    final lead = offline ? 'Offline' : 'Showing saved data';
    return updatedAtMs == null ? lead : '$lead \u00b7 updated ${ago(updatedAtMs!, now: now)}';
  }

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: 40),
        padding: const EdgeInsets.only(left: LbSpace.screen, right: 4, top: 4, bottom: 4),
        color: c.warnBg,
        child: Row(
          children: [
            LbIcon(LbIcons.cloudOff, size: 16, color: c.warn),
            const SizedBox(width: 8),
            Expanded(child: Text(text, style: Theme.of(context).textTheme.labelMedium!.copyWith(color: c.warn))),
            if (onRetry != null) TextButton(onPressed: onRetry, style: TextButton.styleFrom(foregroundColor: c.warn), child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
