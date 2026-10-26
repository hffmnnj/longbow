import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';

/// Warn chip shown while the server's live-trading lock keeps the broker
/// read-only. Renders nothing once live trading is on. Tapping opens a short
/// explainer sheet. Reads the harness store itself.
class LiveLockChip extends ConsumerWidget {
  const LiveLockChip({super.key});

  void _explain(BuildContext context) {
    showLbSheet(
      context,
      (_) => Text(
        'The broker is read-only. Orders are risk-checked and recorded, never sent. '
        'The server keeps Robinhood read-only until HARNESS_LIVE_TRADING is set on the server.',
        style: Theme.of(context).textTheme.bodyMedium,
      ),
      title: 'Live trading locked',
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locked = ref.watch(
      harnessProvider.select((s) => s.feed.status == null ? null : !s.feed.status!.liveTrading),
    );
    if (locked != true) return const SizedBox.shrink();
    return Semantics(
      button: true,
      label: 'Live trading locked. Show why',
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(LbRadius.sm),
        onTap: () => _explain(context),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: const StatusChip('Read-only', tone: StatusTone.warn, icon: LbIcons.lock),
        ),
      ),
    );
  }
}
