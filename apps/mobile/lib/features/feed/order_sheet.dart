import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/orders.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'order_card.dart';
import 'risk_checks.dart';

/// Opens the order detail modal sheet for [orderId].
Future<void> showOrderSheet(BuildContext context, String orderId) {
  return showLbSheet<void>(context, (_) => OrderSheetBody(orderId: orderId), title: 'Order');
}

/// Full detail of one order, resolved by id from the live account. Keeps the
/// last known copy if the order drops out of the recent list while open, and
/// says so plainly when it was never there.
class OrderSheetBody extends ConsumerStatefulWidget {
  const OrderSheetBody({super.key, required this.orderId});

  final String orderId;

  @override
  ConsumerState<OrderSheetBody> createState() => _OrderSheetBodyState();
}

class _OrderSheetBodyState extends ConsumerState<OrderSheetBody> {
  OrderRecord? _last;

  @override
  Widget build(BuildContext context) {
    final found = ref.watch(harnessProvider.select((s) {
      for (final o in s.feed.orders) {
        if (o.id == widget.orderId) return o;
      }
      return null;
    }));
    if (found != null) _last = found;
    final order = found ?? _last;
    if (order == null) {
      return const Padding(
        padding: EdgeInsets.only(bottom: LbSpace.screen),
        child: Empty(
          title: 'Order not found',
          message: 'This order is no longer in the recent list.',
          icon: LbIcons.searching,
        ),
      );
    }
    final i = order.intent;
    final pending = order.status == OrderStatus.pendingApproval;
    final c = context.lb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (pending)
          OrderCard(order: order)
        else ...[
          Wrap(
            spacing: 10,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SideBadge(i.side.name),
              TickerLink(i.symbol, style: LbText.number(context, size: 16, weight: FontWeight.w600)),
              StatusChip(statusLabel(order.status), tone: orderStatusTone(order.status)),
              Text(etStamp(order.createdAt), style: LbText.number(context, size: 12, weight: FontWeight.w400, color: c.mutedForeground)),
            ],
          ),
          const SizedBox(height: 8),
          KeyValueList(
            rows: [
              KeyValueRow('Size', value: '${qty(i.quantity)} @ ${usd(i.limitPrice)}'),
              KeyValueRow('Notional', value: usd(notional(i))),
              KeyValueRow('Order type', value: i.orderType == OrderType.stopLimit ? 'Stop limit' : 'Limit', mono: false),
              if (i.stopPrice != null && i.stopPrice! > 0) KeyValueRow('Stop', value: usd(i.stopPrice!)),
              KeyValueRow('Time in force', value: i.timeInForce == TimeInForce.gtc ? 'Good till cancelled' : 'Day', mono: false),
              KeyValueRow('Invalidation', value: usd(i.invalidationPrice)),
              KeyValueRow('Time stop', value: i.timeStopDate),
              KeyValueRow('Expected value', value: pctSigned(expectedValuePct(i))),
              KeyValueRow('Win probability', value: pct(i.probabilityWin * 100)),
              KeyValueRow('Estimated cost', value: pct(i.estimatedCostPct)),
              if (i.sector != null && i.sector!.isNotEmpty) KeyValueRow('Sector', value: i.sector!, mono: false),
              if (order.averageFillPrice != null)
                KeyValueRow('Filled', value: '${qty(order.filledQuantity ?? 0)} @ ${usd(order.averageFillPrice!)}'),
              KeyValueRow('Updated', value: etStamp(order.updatedAt)),
            ],
          ),
          const SizedBox(height: LbSpace.gap),
          SectionLabel('Thesis'),
          const SizedBox(height: 4),
          Text(i.thesis, style: Theme.of(context).textTheme.bodyMedium!.copyWith(fontSize: 14, height: 1.45)),
          if (order.error != null && order.error!.isNotEmpty) ...[
            const SizedBox(height: LbSpace.gap),
            Text(order.error!, style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: c.loss)),
          ],
          if (order.review != null && order.review!.isNotEmpty) ...[
            const SizedBox(height: LbSpace.gap),
            Text(order.review!, style: LbText.muted(context, size: 14)),
          ],
          const SizedBox(height: 6),
          RiskChecks(verdict: order.verdict, initiallyOpen: true),
        ],
        if (i.evidence.isNotEmpty) ...[
          const SizedBox(height: LbSpace.gap),
          SectionLabel('Evidence ${i.evidence.length}'),
          const SizedBox(height: 6),
          for (final ev in i.evidence)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 8, right: 8),
                    child: DecoratedBox(
                      decoration: BoxDecoration(color: c.mutedForeground, shape: BoxShape.circle),
                      child: const SizedBox.square(dimension: 4),
                    ),
                  ),
                  Expanded(child: SelectableText(ev, style: LbText.muted(context, size: 13.5))),
                ],
              ),
            ),
        ],
      ],
    );
  }
}
