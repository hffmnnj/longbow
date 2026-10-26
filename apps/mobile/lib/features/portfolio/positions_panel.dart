import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/analytics_calc.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'portfolio_logic.dart';

/// What is held, biggest first: size, result, one month trend and how far the
/// price sits above its stop.
class PositionsPanel extends ConsumerWidget {
  const PositionsPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(harnessProvider.select((s) => s.feed.status));
    final perf = ref.watch(harnessProvider.select((s) => s.performance));
    if (status == null) return const SkeletonBlock(height: 200, radius: LbRadius.lg);
    final account = status.account;
    final rows = positionStops(account?.positions ?? const [], perf.data?.exposure ?? const [], account?.equity ?? 0);
    final equity = account?.equity ?? 0;
    final invested = rows.fold<double>(0, (a, r) => a + r.position.marketValue);
    final reading = rows.isEmpty
        ? null
        : '${rows.length} held, ${pct(equity > 0 ? invested / equity * 100 : 0)} of equity invested';

    Widget body;
    if (rows.isEmpty) {
      final disconnected = status.broker.state != BrokerState.connected;
      body = Empty(
        title: disconnected ? 'Robinhood not connected' : 'No positions',
        message: disconnected ? 'Connect it from Settings.' : 'The portfolio is all cash.',
        icon: LbIcons.briefcase01,
      );
    } else {
      body = Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) Divider(height: 1, color: context.lb.border),
            PositionRow(key: ValueKey(rows[i].position.symbol), row: rows[i]),
          ],
        ],
      );
    }
    return Panel(title: 'Positions', reading: reading, padChild: false, child: body);
  }
}

class PositionRow extends ConsumerStatefulWidget {
  const PositionRow({super.key, required this.row});

  final PositionStop row;

  @override
  ConsumerState<PositionRow> createState() => _PositionRowState();
}

class _PositionRowState extends ConsumerState<PositionRow> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(ref.read(harnessProvider.notifier).loadHistory(widget.row.position.symbol, HistoryRange.oneMonth));
    });
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.row;
    final p = r.position;
    final c = context.lb;
    final t = Theme.of(context).textTheme;
    final big = MediaQuery.textScalerOf(context).scale(14) > 22;
    final ret = returnOnCost(p);
    final stop = r.stopPrice;
    final dist = r.distancePct;
    final hasStop = stop != null && dist != null;
    final label = [
      p.symbol,
      '${qtyFor(p.symbol, p.quantity)} ${qtyUnit(p.symbol)}',
      'value ${usd(p.marketValue)}',
      '${p.unrealizedPnl >= 0 ? 'up' : 'down'} ${usd(p.unrealizedPnl.abs())}',
      if (r.weightPct != null) '${pct(r.weightPct!)} of equity',
      hasStop ? (dist >= 0 ? '${pct(dist)} above its stop at ${usd(stop)}' : 'through its stop at ${usd(stop)} by ${pct(dist.abs())}') : 'no stop',
    ].join(', ');

    return Semantics(
      button: true,
      label: label,
      hint: 'Opens the ${p.symbol} chart',
      excludeSemantics: true,
      child: InkWell(
        onTap: () => AppNav.symbol(context, p.symbol),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: LbSpace.card, vertical: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      flex: 4,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(child: TickerLink(p.symbol)),
                              if (p.sector == 'Crypto')
                                const StatusChip('Crypto', tone: StatusTone.neutral, showIcon: false),
                            ],
                          ),
                          Text('${qtyFor(p.symbol, p.quantity)} ${isCryptoSymbol(p.symbol) ? 'coins' : 'sh'}', style: LbText.number(context, size: 12, color: c.mutedForeground)),
                          if (r.weightPct != null)
                            Text('${pct(r.weightPct!)} of equity', style: LbText.number(context, size: 12, color: c.mutedForeground)),
                        ],
                      ),
                    ),
                    if (!big) ...[
                      _Trend(symbol: p.symbol),
                      const SizedBox(width: 10),
                    ],
                    Expanded(
                      flex: 7,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerRight,
                            child: Text(usd(p.marketValue), maxLines: 1, style: LbText.number(context, size: 15, weight: FontWeight.w600)),
                          ),
                          Pnl(amount: p.unrealizedPnl, percent: ret, size: 12.5, textAlign: TextAlign.end),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (hasStop) ...[
                  Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 8,
                    children: [
                      Text('To stop ${usd(stop)}', style: t.labelSmall?.copyWith(color: c.mutedForeground)),
                      Text(
                        dist >= 0 ? '${pct(dist)} above' : '${pct(dist.abs())} through',
                        style: LbText.number(context, size: 12, color: dist < 0 ? c.loss : null),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  BarStrip(
                    value: dist < 0 ? 0 : dist,
                    max: 15,
                    height: 6,
                    tone: stopTone(dist),
                    semanticsLabel: dist >= 0
                        ? '${p.symbol} is ${pct(dist)} above its stop at ${usd(stop)}'
                        : '${p.symbol} is ${pct(dist.abs())} through its stop at ${usd(stop)}',
                  ),
                ] else
                  Text('No stop', style: t.labelSmall?.copyWith(color: c.mutedForeground)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Trend extends ConsumerWidget {
  const _Trend({required this.symbol});

  final String symbol;
  static const double width = 56;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final entry = ref.watch(harnessProvider.select((s) => s.history['$symbol:${historyRangeWire(HistoryRange.oneMonth)}']));
    final closes = [for (final b in entry?.data?.bars ?? const <Bar>[]) b.close];
    final Widget child;
    if (closes.length > 1) {
      child = Sparkline(values: closes, width: width, height: 24, semanticsLabel: '$symbol one month trend');
    } else if (entry?.state == LoadState.error || (entry?.state == LoadState.ready)) {
      child = Text('\u2014', textAlign: TextAlign.center, style: LbText.muted(context));
    } else {
      child = const Align(child: SkeletonBlock(width: width, height: 12));
    }
    return SizedBox(width: width, height: 24, child: child);
  }
}
