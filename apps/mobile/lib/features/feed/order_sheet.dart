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
    final quoteLabel = fractionalQuoteLabel(i);
    final isOption = isOptionIntent(i);
    final ticket = i.longOption;
    final validOption = isValidOptionIntent(i);
    final problem = isOption ? optionProblem(i) : null;
    final c = context.lb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (pending)
          OrderCard(order: order)
        else if (isOption && ticket != null && validOption) ...[
          Wrap(
            spacing: 10,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SideBadge(i.side.name),
              const StatusChip('Option', tone: StatusTone.live, showIcon: false),
              TickerLink(i.symbol, style: LbText.number(context, size: 16, weight: FontWeight.w600)),
              StatusChip(orderStatusLabel(order), tone: orderStatusTone(order.status)),
              Text(etStamp(order.createdAt), style: LbText.number(context, size: 12, weight: FontWeight.w400, color: c.mutedForeground)),
            ],
          ),
          const SizedBox(height: 8),
          KeyValueList(
            rows: [
              KeyValueRow('Contract',
                  value: '${i.symbol} ${usd(optionStrike(ticket))} ${optionTypeLabel(ticket).toLowerCase()} · Exp ${optionExpiryLabel(ticket.expiration)}'),
              KeyValueRow('Side', value: optionSideLabel(ticket), mono: false),
              KeyValueRow('Contracts', value: '${ticket.contracts}'),
              KeyValueRow('Limit / share', value: usd(optionLimitPerShare(ticket))),
              KeyValueRow('Total at limit',
                  value:
                      '${usd(optionTotal(ticket))} ${ticket.side == OptionTicketSide.buyToOpen ? 'debit' : 'proceeds'}'),
              KeyValueRow('Expiration', value: optionExpiryLabel(ticket.expiration)),
              KeyValueRow('Time in force', value: 'Day · order expires at today\'s close', mono: false),
              KeyValueRow('Underlying invalidation', value: usd(i.invalidationPrice)),
              KeyValueRow('Time stop', value: i.timeStopDate),
              KeyValueRow('Expected value', value: pctSigned(expectedValuePct(i))),
              KeyValueRow('Win probability', value: pct(i.probabilityWin * 100)),
              KeyValueRow('Estimated cost', value: pct(i.estimatedCostPct)),
              if (i.sector != null && i.sector!.isNotEmpty) KeyValueRow('Sector', value: i.sector!, mono: false),
              if (order.averageFillPrice != null)
                KeyValueRow('Filled',
                    value:
                        '${qtyFor(i.symbol, order.filledQuantity ?? 0)} of ${qtyFor(i.symbol, i.quantity)} @ ${usd(order.averageFillPrice!)}/sh · ${usd(optionFilledTotal(order.filledQuantity ?? 0, order.averageFillPrice!))}'),
              KeyValueRow('Updated', value: etStamp(order.updatedAt)),
            ],
          ),
          const SizedBox(height: LbSpace.gap),
          Text('If exercised, this can create ${ticket.symbol} stock. A fill is not guaranteed at the limit.',
              style: LbText.muted(context, size: 13)),
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
        ] else if (isOption) ...[
          Wrap(
            spacing: 10,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SideBadge(i.side.name),
              const StatusChip('Option', tone: StatusTone.warn, showIcon: false),
              TickerLink(i.symbol, style: LbText.number(context, size: 16, weight: FontWeight.w600)),
              StatusChip(orderStatusLabel(order), tone: orderStatusTone(order.status)),
              Text(etStamp(order.createdAt), style: LbText.number(context, size: 12, weight: FontWeight.w400, color: c.mutedForeground)),
            ],
          ),
          const SizedBox(height: 8),
          Text('Option details need review.',
              style: Theme.of(context).textTheme.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text('${problem ?? 'Contract details are incomplete or malformed.'} This ticket shows no share quantity, price, or approval.',
              style: LbText.muted(context, size: 14)),
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
        ] else ...[
          Wrap(
            spacing: 10,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SideBadge(i.side.name),
              TickerLink(i.symbol, style: LbText.number(context, size: 16, weight: FontWeight.w600)),
              StatusChip(orderStatusLabel(order), tone: orderStatusTone(order.status)),
              Text(etStamp(order.createdAt), style: LbText.number(context, size: 12, weight: FontWeight.w400, color: c.mutedForeground)),
            ],
          ),
          const SizedBox(height: 8),
          KeyValueList(
            rows: [
              if (quoteLabel == null)
                KeyValueRow('Size', value: '${qtyFor(i.symbol, i.quantity)} @ ${usd(i.limitPrice)}')
              else ...[
                KeyValueRow('Size', value: '${qtyFor(i.symbol, i.quantity)} ${qtyUnit(i.symbol)}'),
                KeyValueRow(quoteLabel, value: usd(i.limitPrice)),
              ],
              KeyValueRow(quoteLabel == null ? 'Notional' : 'Intent notional', value: usd(notional(i))),
              if (quoteLabel == null)
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
                KeyValueRow('Filled', value: '${qtyFor(i.symbol, order.filledQuantity ?? 0)} @ ${usd(order.averageFillPrice!)}'),
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
