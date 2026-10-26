import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/models/models.dart';

import 'status_text.dart';

/// Market session with the countdown to the next open or close.
class SessionChip extends ConsumerWidget {
  const SessionChip({super.key, this.detailed = false});

  final bool detailed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final market = ref.watch(harnessProvider.select((s) => s.feed.status?.market));
    if (market == null) return const SkeletonBlock(width: 120, height: 24);
    final nowMs = ref.watch(clockProvider).millisecondsSinceEpoch;
    final next = sessionNext(market);
    final label = sessionLabel(market.session);
    final tone = market.session == MarketSession.regular ? StatusTone.live : StatusTone.neutral;

    if (!detailed) {
      return StatusChip('$label \u00b7 ${next.verb.toLowerCase()} ${coarseCountdown(next.at - nowMs)}', tone: tone);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Align(alignment: Alignment.centerLeft, child: StatusChip(label, tone: tone)),
        const SizedBox(height: 6),
        Text.rich(
          TextSpan(
            style: LbText.muted(context),
            children: [
              TextSpan(text: '${next.verb} '),
              TextSpan(text: countdown(next.at - nowMs), style: LbText.number(context, size: 13)),
              const TextSpan(text: ' \u00b7 '),
              TextSpan(text: etClock(nowMs), style: LbText.number(context, size: 13, color: context.lb.mutedForeground)),
            ],
          ),
        ),
      ],
    );
  }
}
