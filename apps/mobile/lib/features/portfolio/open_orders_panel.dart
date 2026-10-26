import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/feed/order_card.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'portfolio_logic.dart';

/// Orders that are still working or waiting on someone, newest first.
class OpenOrdersPanel extends ConsumerWidget {
  const OpenOrdersPanel({super.key, this.onSeeAll, this.limit = 3});

  /// Opens the full Journal and orders screen; the link is hidden without it.
  final VoidCallback? onSeeAll;
  final int limit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final loaded = ref.watch(harnessProvider.select((s) => s.loaded));
    final all = ref.watch(harnessProvider.select((s) => s.feed.orders));
    if (!loaded && all.isEmpty) return const SkeletonBlock(height: 96, radius: LbRadius.lg);
    final open = openOrders(all);
    final waiting = open.where((o) => o.status == OrderStatus.pendingApproval).length;
    final reading = open.isEmpty
        ? null
        : '${open.length} open${waiting > 0 ? ', $waiting awaiting approval' : ''}';
    return Panel(
      title: 'Open orders',
      reading: reading,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (open.isEmpty)
            Text('No orders are working.', style: LbText.muted(context))
          else
            for (var i = 0; i < open.take(limit).length; i++) ...[
              if (i > 0) const SizedBox(height: LbSpace.gap),
              OrderCard(key: ValueKey(open[i].id), order: open[i]),
            ],
          if (onSeeAll != null) ...[
            const SizedBox(height: 4),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: onSeeAll,
                icon: const LbIcon(LbIcons.arrowRight01, size: 16),
                iconAlignment: IconAlignment.end,
                label: Text(open.length > limit ? 'See all ${open.length} in Journal and orders' : 'Journal and orders'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
