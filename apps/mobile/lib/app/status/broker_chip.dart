import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/features/settings/robinhood_sign_in.dart';
import 'package:longbow/models/models.dart';

import 'status_text.dart';

/// Robinhood connection state. In the header pill row it only appears when
/// something needs attention; [detailed] always shows, with a Connect button
/// when sign-in is needed.
class BrokerChip extends ConsumerWidget {
  const BrokerChip({super.key, this.detailed = false});

  final bool detailed;

  static StatusTone toneOf(BrokerState state) => switch (state) {
        BrokerState.connected => StatusTone.neutral,
        BrokerState.connecting => StatusTone.warn,
        BrokerState.disconnected || BrokerState.needsAuth => StatusTone.warn,
        BrokerState.error => StatusTone.loss,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final broker = ref.watch(harnessProvider.select((s) => s.feed.status?.broker));
    if (broker == null) return detailed ? const SkeletonBlock(width: 140, height: 24) : const SizedBox.shrink();
    final connected = broker.state == BrokerState.connected;
    if (!detailed && connected) return const SizedBox.shrink();

    final label = 'Robinhood ${brokerLabel(broker.state).toLowerCase()}';
    final chip = StatusChip(
      label,
      tone: toneOf(broker.state),
      icon: connected ? LbIcons.checkmarkCircle02 : null,
    );
    if (!detailed) return chip;

    final needsConnect = brokerNeedsConnect(broker.state);
    final busy = ref.watch(harnessProvider.select((s) => s.busy['connect'] ?? false));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Align(alignment: Alignment.centerLeft, child: chip),
        if (broker.state == BrokerState.error && broker.error != null) ...[
          const SizedBox(height: 6),
          Text(broker.error!, maxLines: 3, overflow: TextOverflow.ellipsis, style: LbText.muted(context).copyWith(color: context.lb.destructive)),
        ],
        if (needsConnect) ...[
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: busy ? null : () => startRobinhoodSignIn(ref),
            icon: const LbIcon(LbIcons.link04, size: 16),
            label: const Text('Connect Robinhood'),
          ),
        ],
      ],
    );
  }
}
