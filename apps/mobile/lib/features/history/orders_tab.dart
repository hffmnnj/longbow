import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/orders.dart'
    show isDoneOrderStatus, isOpenOrderStatus;
import 'package:longbow/models/models.dart';

import '../feed/order_card.dart';

enum _OrderFilter { all, open, filled, rejected }

String _labelOf(_OrderFilter f) => switch (f) {
  _OrderFilter.all => 'All',
  _OrderFilter.open => 'Open',
  _OrderFilter.filled => 'Filled',
  _OrderFilter.rejected => 'Rejected',
};

/// Orders are terminal "rejected" when they reached a done state without a
/// fill (rejected, expired, cancelled, failed); "open" is everything still
/// working or waiting, from `orders.dart`.
bool _matches(_OrderFilter filter, OrderRecord o) => switch (filter) {
  _OrderFilter.all => true,
  _OrderFilter.open => isOpenOrderStatus(o.status),
  _OrderFilter.filled => o.status == OrderStatus.filled,
  _OrderFilter.rejected =>
    isDoneOrderStatus(o.status) && o.status != OrderStatus.filled,
};

/// Every order with status filter chips. Port of the web `OrdersList`.
class OrdersTab extends ConsumerStatefulWidget {
  const OrdersTab({super.key});

  @override
  ConsumerState<OrdersTab> createState() => _OrdersTabState();
}

class _OrdersTabState extends ConsumerState<OrdersTab> {
  _OrderFilter _filter = _OrderFilter.all;

  @override
  Widget build(BuildContext context) {
    final loaded = ref.watch(harnessProvider.select((s) => s.loaded));
    final orders = ref.watch(harnessProvider.select((s) => s.feed.orders));
    final loadError = ref.watch(harnessProvider.select((s) => s.loadError));

    if (!loaded) {
      return const SliverToBoxAdapter(child: _OrdersSkeleton());
    }

    var list = orders.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    list = list.where((o) => _matches(_filter, o)).toList();
    final filtering = _filter != _OrderFilter.all;

    return SliverMainAxisGroup(
      slivers: [
        SliverToBoxAdapter(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LbSegmented<_OrderFilter>(
                semanticLabel: 'Order status',
                selected: _filter,
                onChanged: (f) => setState(() => _filter = f),
                segments: [
                  for (final f in _OrderFilter.values)
                    LbSegment(f, _labelOf(f)),
                ],
              ),
              if (loadError != null) ...[
                const SizedBox(height: 6),
                Text(
                  'Could not refresh: $loadError',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: context.lb.warn,
                  ),
                ),
              ],
              const SizedBox(height: 4),
            ],
          ),
        ),
        if (list.isEmpty)
          SliverToBoxAdapter(
            child: Empty(
              title: filtering ? 'No orders match' : 'No orders yet',
              message:
                  filtering
                      ? 'Try a different status.'
                      : 'Orders the agent submits appear here.',
              action:
                  filtering
                      ? TextButton(
                        onPressed: () => setState(() {
                          _filter = _OrderFilter.all;
                        }),
                        child: const Text('Clear filter'),
                      )
                      : null,
            ),
          )
        else
          SliverList.builder(
            itemCount: list.length,
            itemBuilder: (context, i) => Padding(
              padding: const EdgeInsets.only(bottom: LbSpace.gap),
              child: OrderCard(order: list[i]),
            ),
          ),
      ],
    );
  }
}

class _OrdersSkeleton extends StatelessWidget {
  const _OrdersSkeleton();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SkeletonBlock(width: 240, height: 36),
        SizedBox(height: LbSpace.gap),
        SkeletonBlock(height: 120),
        SizedBox(height: LbSpace.gap),
        SkeletonBlock(height: 120),
      ],
    );
  }
}
