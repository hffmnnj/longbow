import 'package:flutter/material.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/domain/analytics_calc.dart' show distanceToStopPct, rangePosition;
import 'package:longbow/domain/orders.dart';
import 'package:longbow/features/feed/decision_card.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'symbol_logic.dart';

/// Moving averages, RSI, ATR, returns, dollar volume and the 52 week range.
class IndicatorsPanel extends StatelessWidget {
  const IndicatorsPanel({super.key, required this.symbol, required this.indicators, required this.price});

  final String symbol;
  final SymbolIndicators indicators;
  final double? price;

  @override
  Widget build(BuildContext context) {
    final cells = indicatorCells(indicators, price);
    final lo = indicators.low52w;
    final hi = indicators.high52w;
    final p = price;
    return Panel(
      title: 'Indicators',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          LayoutBuilder(
            builder: (context, box) {
              const gap = 16.0;
              final cols = box.maxWidth >= 520 ? 4 : 2;
              final w = (box.maxWidth - gap * (cols - 1)) / cols;
              return Wrap(
                spacing: gap,
                runSpacing: 14,
                children: [
                  for (final cell in cells)
                    SizedBox(
                      width: w,
                      child: Stat(label: cell.label, value: cell.value, sub: cell.sub, tone: cell.tone),
                    ),
                ],
              );
            },
          ),
          if (lo != null && hi != null && p != null) ...[
            const SizedBox(height: LbSpace.gap),
            Row(
              children: [
                Expanded(child: Text('52-week low ${usd(lo)}', style: LbText.number(context, size: 11.5, color: context.lb.mutedForeground))),
                const SizedBox(width: 8),
                Text('high ${usd(hi)}', style: LbText.number(context, size: 11.5, color: context.lb.mutedForeground)),
              ],
            ),
            const SizedBox(height: 6),
            BarStrip(
              value: rangePosition(p, lo, hi),
              tone: ChartTone.primary,
              semanticsLabel: '$symbol sits ${rangePosition(p, lo, hi).round()}% of the way up its 52 week range',
            ),
          ],
        ],
      ),
    );
  }
}

/// Shares, cost, value, unrealized result and the stop with its source.
class PositionPanel extends StatelessWidget {
  const PositionPanel({super.key, required this.position, this.stop, this.price});

  final Position position;
  final StopInfo? stop;
  final double? price;

  @override
  Widget build(BuildContext context) {
    final cost = position.marketValue - position.unrealizedPnl;
    final ret = cost > 0 ? position.unrealizedPnl / cost * 100 : null;
    final s = stop;
    final px = price;
    return Panel(
      title: 'Position',
      child: KeyValueList(
        rows: [
          KeyValueRow(isCryptoSymbol(position.symbol) ? 'Coins' : 'Shares', value: qtyFor(position.symbol, position.quantity)),
          KeyValueRow('Average cost', value: usd(position.averageCost)),
          KeyValueRow('Market value', value: usd(position.marketValue)),
          KeyValueRow('Unrealized', valueWidget: Pnl(amount: position.unrealizedPnl, percent: ret)),
          if (s != null)
            KeyValueRow(
              'Stop',
              valueWidget: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(usd(s.price), style: LbText.number(context, color: context.lb.loss)),
                  Text(
                    [
                      'from the ${stopSourceLabel(s.source)}',
                      if (px != null && px > 0) '${pct(distanceToStopPct(px, s.price).abs())} ${px >= s.price ? 'below price' : 'above price'}',
                    ].join(' \u00b7 '),
                    textAlign: TextAlign.end,
                    style: LbText.muted(context, size: 12),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// The agent's thesis note; tap opens the full note.
class ThesisPanel extends StatelessWidget {
  const ThesisPanel({super.key, required this.note});

  final NoteContent note;

  @override
  Widget build(BuildContext context) {
    return Panel(
      title: 'Thesis',
      actions: TextButton(onPressed: () => AppNav.note(context, note.path), child: const Text('Open note')),
      child: Semantics(
        button: true,
        hint: 'Opens the full note',
        child: InkWell(
          borderRadius: BorderRadius.circular(LbRadius.sm),
          onTap: () => AppNav.note(context, note.path),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 280),
            child: SingleChildScrollView(
              physics: const NeverScrollableScrollPhysics(),
              child: LbMarkdown(note.content, selectable: false),
            ),
          ),
        ),
      ),
    );
  }
}

/// This symbol's orders, newest first; tap opens the order.
class SymbolOrdersPanel extends StatelessWidget {
  const SymbolOrdersPanel({super.key, required this.symbol, required this.orders});

  final String symbol;
  final List<OrderRecord> orders;

  @override
  Widget build(BuildContext context) {
    final sorted = [...orders]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    final now = DateTime.now().millisecondsSinceEpoch;
    return Panel(
      title: 'Orders',
      padChild: false,
      child: sorted.isEmpty
          ? Padding(
              padding: const EdgeInsets.fromLTRB(LbSpace.card, 0, LbSpace.card, LbSpace.card),
              child: Text('No orders for $symbol', style: LbText.muted(context)),
            )
          : Column(
              children: [
                for (var i = 0; i < sorted.take(6).length; i++) ...[
                  if (i > 0) Divider(height: 1, color: context.lb.border),
                  _OrderRow(order: sorted[i], now: now),
                ],
              ],
            ),
    );
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow({required this.order, required this.now});

  final OrderRecord order;
  final int now;

  @override
  Widget build(BuildContext context) {
    final o = order;
    final status = '${statusLabel(o.status)} \u00b7 ${ago(o.createdAt, now: now)}';
    return Semantics(
      button: true,
      label: '${o.intent.side == OrderSide.buy ? 'Buy' : 'Sell'} ${orderLine(o)}, $status',
      excludeSemantics: true,
      child: InkWell(
        onTap: () => AppNav.order(context, o.id),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: LbSpace.card, vertical: 8),
            child: Row(
              children: [
                SideBadge(o.intent.side.name),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(orderLine(o), style: LbText.number(context, size: 13)),
                      Text(status, style: LbText.muted(context, size: 12)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// This symbol's recent decisions as decision cards.
class SymbolJournalPanel extends StatelessWidget {
  const SymbolJournalPanel({super.key, required this.symbol, required this.entries});

  final String symbol;
  final List<JournalEntry> entries;

  @override
  Widget build(BuildContext context) {
    final sorted = [...entries]..sort((a, b) => b.at.compareTo(a.at));
    return Panel(
      title: 'Recent decisions',
      child: sorted.isEmpty
          ? Text('No journal entries for $symbol', style: LbText.muted(context))
          : Column(
              children: [
                for (var i = 0; i < sorted.take(5).length; i++) ...[
                  if (i > 0) const SizedBox(height: LbSpace.gap),
                  DecisionCard(key: ValueKey(sorted[i].id), entry: sorted[i]),
                ],
              ],
            ),
    );
  }
}
