import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/analytics_calc.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

/// Analytic dashboard for closed-trade skill: the headline strip first, then
/// P&L per trade with the trade list beneath it, calibration against order
/// outcomes, and exposure with sector weights. Each block reads the same
/// [PerformanceSummary] loadable independently, so one slow panel never
/// blocks the others and stale figures stay visible while a refresh runs.
class PerformanceScreen extends ConsumerStatefulWidget {
  const PerformanceScreen({super.key});

  @override
  ConsumerState<PerformanceScreen> createState() => _PerformanceScreenState();
}

class _PerformanceScreenState extends ConsumerState<PerformanceScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (!mounted) return;
      final store = ref.read(harnessProvider.notifier);
      store.loadPerformance();
      store.loadReports();
    });
  }

  Future<void> _refresh() async {
    final store = ref.read(harnessProvider.notifier);
    await Future.wait([
      store.loadPerformance(force: true),
      store.loadReports(force: true),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final performance =
        ref.watch(harnessProvider.select((s) => s.performance));
    final offline = ref.watch(
      harnessProvider.select((s) => s.connection == ConnectionStatus.offline),
    );
    final risk = ref.watch(
      harnessProvider.select((s) => s.feed.status?.settings.risk),
    );
    final reports =
        ref.watch(harnessProvider.select((s) => s.reports)).data ?? const [];
    return LbTabBody.children(
      onRefresh: _refresh,
      children: [
        if (offline)
          StaleBanner(
            offline: true,
            updatedAtMs: performance.at,
            onRetry: _refresh,
          ),
        LoadableView<PerformanceSummary>(
          loadable: performance,
          onRetry: _refresh,
          // Tall enough that the error state and its Retry button fit.
          skeletonHeight: 280,
          builder: (context, p) {
            if (p.trades.isEmpty) {
              return const Panel(
                title: 'Performance',
                reading: 'No closed trades yet.',
                child: Empty(
                  title: 'No closed trades yet',
                  message:
                      'Win rate, R multiples and calibration appear once the first position is closed.',
                ),
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _OverviewStrip(summary: p),
                const SizedBox(height: LbSpace.gap),
                _PnlPanel(summary: p, reports: reports),
                const SizedBox(height: LbSpace.gap),
                _twoCol(
                  context,
                  _CalibrationPanel(summary: p),
                  _OutcomesPanel(summary: p),
                ),
                const SizedBox(height: LbSpace.gap),
                _twoCol(
                  context,
                  _ExposurePanel(summary: p, risk: risk),
                  _SectorsPanel(summary: p, risk: risk),
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}

/// Two panels side by side on wide screens, stacked on phones.
Widget _twoCol(BuildContext context, Widget a, Widget b) =>
    LayoutBuilder(builder: (context, box) {
      if (box.maxWidth >= 840) {
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: a),
            const SizedBox(width: LbSpace.gap),
            Expanded(child: b),
          ],
        );
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [a, const SizedBox(height: LbSpace.gap), b],
      );
    });

String _formatR(double v) =>
    '${v >= 0 ? '+' : kMinus}${v.abs().toStringAsFixed(2)}R';

String _formatR1(double v) =>
    '${v >= 0 ? '+' : kMinus}${v.abs().toStringAsFixed(1)}R';

/// The six headline figures: realized P&L net of fees first, then the skill
/// ratios. Missing figures print as a dash, never as zero.
class _OverviewStrip extends StatelessWidget {
  const _OverviewStrip({required this.summary});

  final PerformanceSummary summary;

  @override
  Widget build(BuildContext context) {
    final p = summary;
    final stats = <Widget>[
      Stat(
        label: 'Realized P&L',
        sub: '${p.trades.length} closed trades',
        child: Pnl(amount: p.realizedPnl, size: 17),
      ),
      Stat(
        label: 'Win rate',
        value: p.winRatePct == null ? null : pct(p.winRatePct!),
      ),
      Stat(
        label: 'Average R',
        value: p.avgR == null ? null : _formatR(p.avgR!),
        sub: 'harness trades with a plan',
        tone: p.avgR == null ? Tone.flat : tone(p.avgR!),
      ),
      Stat(
        label: 'Expectancy',
        sub: 'per closed trade',
        child: p.expectancy == null
            ? Text(
                '—',
                style: LbText.number(context, size: 17, weight: FontWeight.w600),
              )
            : Pnl(amount: p.expectancy!, size: 17),
      ),
      Stat(
        label: 'Profit factor',
        value: p.profitFactor?.toStringAsFixed(2),
        sub: 'gross wins / gross losses',
      ),
      Stat(
        label: 'Avg holding',
        value: p.avgHoldingDays == null
            ? null
            : '${p.avgHoldingDays!.toStringAsFixed(1)} days',
      ),
    ];
    return Panel(
      title: 'Overview',
      reading: pnlReading(p.trades),
      child: LayoutBuilder(builder: (context, box) {
        final cols = box.maxWidth >= 600 ? 3 : 2;
        final rows = <Widget>[];
        for (var i = 0; i < stats.length; i += cols) {
          final slice = stats.sublist(i, (i + cols).clamp(0, stats.length));
          rows.add(
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var j = 0; j < slice.length; j++) ...[
                  if (j > 0) const SizedBox(width: LbSpace.gap),
                  Expanded(child: slice[j]),
                ],
              ],
            ),
          );
          if (i + cols < stats.length) {
            rows.add(const SizedBox(height: LbSpace.gap));
          }
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: rows,
        );
      }),
    );
  }
}

/// Profit and loss per closed trade, with the trade list beneath it. Harness
/// trades open their trade report when the reports list carries one; anything
/// else opens the symbol chart.
class _PnlPanel extends StatelessWidget {
  const _PnlPanel({required this.summary, required this.reports});

  final PerformanceSummary summary;
  final List<ReportSummary> reports;

  @override
  Widget build(BuildContext context) {
    final bars = pnlBars(summary.trades);
    final trades = List<ClosedTrade>.of(summary.trades)
      ..sort((a, b) => b.closedAt.compareTo(a.closedAt));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Panel(
          title: 'P&L per trade',
          reading: pnlReading(summary.trades),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ColumnChart(
                categories: bars.map((b) => b.label).toList(),
                series: [
                  ColumnSeries(
                    values: bars.map((b) => b.pnl).toList(),
                    name: 'P&L',
                  ),
                ],
                colorBySign: true,
                valueFormatter: (v) => usd(v),
                height: 200,
                semanticsLabel: pnlReading(summary.trades) ??
                    'Profit and loss for each closed trade',
              ),
              const SizedBox(height: 8),
              _legend(context),
            ],
          ),
        ),
        const SizedBox(height: LbSpace.gap),
        Panel(
          title: 'Closed trades',
          reading:
              'Newest first. Older trades come from Robinhood\'s own history and carry no plan, so they have no R multiple.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var i = 0; i < trades.length; i++) ...[
                if (i > 0) const Divider(height: 1),
                _TradeRow(
                  trade: trades[i],
                  reportId: _matchingReportId(reports, trades[i]),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _legend(BuildContext context) {
    final c = context.lb;
    Widget dot(Color color, String label) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: color,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(width: 6),
            Text(label, style: LbText.muted(context, size: 11.5)),
          ],
        );
    return Wrap(
      spacing: 16,
      children: [dot(c.gain, 'Win'), dot(c.loss, 'Loss')],
    );
  }
}

/// The id of the trade report for [trade], when the reports list carries one.
String? _matchingReportId(List<ReportSummary> reports, ClosedTrade trade) {
  if (trade.source != TradeSource.harness) return null;
  for (final r in reports) {
    if (r.kind == ReportKind.trade && r.symbol == trade.symbol) {
      return r.id;
    }
  }
  return null;
}

class _TradeRow extends StatelessWidget {
  const _TradeRow({
    required this.trade,
    required this.reportId,
  });

  final ClosedTrade trade;
  final String? reportId;

  void _open(BuildContext context) {
    final id = reportId;
    if (id != null) {
      AppNav.report(context, id);
    } else {
      AppNav.symbol(context, trade.symbol);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = trade;
    final entry = t.entryPrice == null
        ? '—'
        : usd(t.entryPrice!);
    final meta = <String>[
      if (t.fees != null && t.fees! > 0) 'incl ${usd(t.fees!)} fees',
      if (t.rMultiple != null) 'R ${_formatR1(t.rMultiple!)}',
      if (t.holdingDays != null)
        '${_holdingDays(t.holdingDays!)} held',
      if (t.probabilityWin != null)
        '${(t.probabilityWin! * 100).round()}% win odds',
    ];
    final label = StringBuffer('${t.symbol} closed trade, ')
      ..write(t.pnl >= 0 ? 'up ' : 'down ')
      ..write(usd(t.pnl.abs()));
    return Semantics(
      button: true,
      label: label.toString(),
      excludeSemantics: true,
      child: InkWell(
        onTap: () => _open(context),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    t.symbol,
                    style: LbText.number(
                      context,
                      size: 14,
                      weight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      etDay(t.closedAt),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: LbText.muted(context, size: 12),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerRight,
                      child: StatusChip(
                        sourceLabel[t.source]!,
                        tone: t.source == TradeSource.harness
                            ? StatusTone.live
                            : StatusTone.neutral,
                        showIcon: false,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${qtyFor(t.symbol, t.quantity)} @ $entry → ${usd(t.exitPrice)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: LbText.number(
                        context,
                        size: 12.5,
                        color: context.lb.mutedForeground,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Pnl(amount: t.pnl, percent: t.pnlPct, size: 13),
                ],
              ),
              if (meta.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  meta.join(' · '),
                  style: LbText.muted(context, size: 11.5),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

String _holdingDays(double days) =>
    '${days % 1 == 0 ? days.toStringAsFixed(0) : days.toStringAsFixed(1)}d';

/// How honest the agent's stated win probabilities were, with the Brier
/// score beneath the buckets.
class _CalibrationPanel extends StatelessWidget {
  const _CalibrationPanel({required this.summary});

  final PerformanceSummary summary;

  @override
  Widget build(BuildContext context) {
    final rows = calibrationRows(summary.calibration);
    final reading = calibrationReading(summary.calibration);
    return Panel(
      title: 'Calibration',
      reading: reading,
      child: rows.isEmpty
          ? const Empty(
              title: 'No calibration yet',
              message:
                  'Needs closed harness trades that carried a stated win probability.',
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CalibrationChart(
                  points: rows
                      .map(
                        (r) => CalibrationPoint(
                          predicted: r.predicted,
                          realized: r.realized,
                          count: r.count,
                          label: r.label,
                        ),
                      )
                      .toList(),
                  semanticsLabel:
                      reading ?? 'Predicted against realized win rate',
                  height: 200,
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Said',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: LbText.caption(context),
                      ),
                    ),
                    SizedBox(
                      width: 64,
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerRight,
                        child: Text(
                          'Predicted',
                          style: LbText.caption(context),
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 64,
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerRight,
                        child: Text(
                          'Realized',
                          style: LbText.caption(context),
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 52,
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerRight,
                        child: Text(
                          'Trades',
                          style: LbText.caption(context),
                        ),
                      ),
                    ),
                  ],
                ),
                for (final r in rows)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            r.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: LbText.number(context, size: 12.5),
                          ),
                        ),
                        SizedBox(
                          width: 64,
                          child: Text(
                            '${r.predicted.toStringAsFixed(0)}%',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.right,
                            style: LbText.number(context, size: 12.5),
                          ),
                        ),
                        SizedBox(
                          width: 64,
                          child: Text(
                            '${r.realized.toStringAsFixed(0)}%',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.right,
                            style: LbText.number(
                              context,
                              size: 12.5,
                              color: r.realized < r.predicted - 10
                                  ? context.lb.loss
                                  : null,
                            ),
                          ),
                        ),
                        SizedBox(
                          width: 52,
                          child: Text(
                            '${r.count}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.right,
                            style: LbText.number(context, size: 12.5),
                          ),
                        ),
                      ],
                    ),
                  ),
                if (summary.brier != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Brier score ${summary.brier!.toStringAsFixed(3)} (0 is perfect, 0.25 is a coin flip)',
                    style: LbText.number(
                      context,
                      size: 11.5,
                      color: context.lb.mutedForeground,
                    ),
                  ),
                ],
              ],
            ),
    );
  }
}

/// Every proposed order by its final state, largest first.
class _OutcomesPanel extends StatelessWidget {
  const _OutcomesPanel({required this.summary});

  final PerformanceSummary summary;

  @override
  Widget build(BuildContext context) {
    final outcomes = _allOutcomes(summary.ordersByStatus);
    final total = outcomes.fold(0, (a, o) => a + o.count);
    final filled = summary.ordersByStatus['filled'] ?? 0;
    return Panel(
      title: 'Order outcomes',
      reading: outcomes.isEmpty
          ? null
          : '$total orders proposed, $filled filled',
      child: outcomes.isEmpty
          ? const Empty(
              title: 'No orders yet',
              message: 'Proposed orders will tally here by outcome.',
            )
          : BarStripList(
              rows: outcomes
                  .map(
                    (o) => BarRow(
                      label: o.label,
                      value: o.count.toDouble(),
                      valueLabel: '${o.count}',
                      tone: _outcomeTone(o.status),
                    ),
                  )
                  .toList(),
              max: outcomes.first.count.toDouble(),
            ),
    );
  }
}

OrderStatus? _statusFromWire(String wire) {
  for (final s in OrderStatus.values) {
    if (_wire(s) == wire) return s;
  }
  return null;
}

String _wire(OrderStatus s) => switch (s) {
      OrderStatus.pendingApproval => 'pending_approval',
      OrderStatus.rejectedRisk => 'rejected_risk',
      OrderStatus.rejectedUser => 'rejected_user',
      OrderStatus.expired => 'expired',
      OrderStatus.submitted => 'submitted',
      OrderStatus.held => 'held',
      OrderStatus.triggering => 'triggering',
      OrderStatus.partiallyFilled => 'partially_filled',
      OrderStatus.filled => 'filled',
      OrderStatus.cancelled => 'cancelled',
      OrderStatus.failed => 'failed',
    };

/// Known statuses through [orderOutcomes]; unknown future wires stay visible
/// as raw keys, largest first.
List<OrderOutcome> _allOutcomes(Map<String, int> counts) {
  final known = <OrderStatus, int>{};
  final unknown = <({String label, int count})>[];
  counts.forEach((wire, count) {
    if (count <= 0) return;
    final status = _statusFromWire(wire);
    if (status == null) {
      unknown.add((label: wire, count: count));
    } else {
      known[status] = (known[status] ?? 0) + count;
    }
  });
  final out = orderOutcomes(known).toList();
  // Unknown wires borrow the muted slot; the label stays the raw wire key.
  for (final u in unknown) {
    out.add(
      OrderOutcome(status: OrderStatus.cancelled, label: u.label, count: u.count),
    );
  }
  out.sort((a, b) => b.count.compareTo(a.count));
  return out;
}

ChartTone _outcomeTone(OrderStatus status) => switch (status) {
      OrderStatus.filled || OrderStatus.partiallyFilled => ChartTone.gain,
      OrderStatus.failed => ChartTone.loss,
      OrderStatus.rejectedRisk => ChartTone.warn,
      OrderStatus.submitted || OrderStatus.pendingApproval => ChartTone.primary,
      _ => ChartTone.muted,
    };

/// Held exposure with the stop plan beside it, plus portfolio heat against
/// the risk cap.
class _ExposurePanel extends StatelessWidget {
  const _ExposurePanel({required this.summary, required this.risk});

  final PerformanceSummary summary;
  final RiskConfig? risk;

  @override
  Widget build(BuildContext context) {
    final rows = List<ExposureRow>.of(summary.exposure)
      ..sort((a, b) => b.marketValue.compareTo(a.marketValue));
    final heat = summary.heatPct;
    final cap = risk == null ? null : heatCapPct(risk!);
    final reading = heat != null && cap != null && cap > 0
        ? 'Heat ${heat.toStringAsFixed(1)}% against a ${cap.toStringAsFixed(1)}% cap'
        : 'Loss to all stops as a percent of equity';
    return Panel(
      title: 'Exposure and stops',
      reading: reading,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (rows.isEmpty)
            const Empty(
              title: 'No exposure',
              message: 'Held positions will list here with their stops.',
            )
          else
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) const Divider(height: 1),
              _ExposureRowView(row: rows[i]),
            ],
          if (heat != null) ...[
            const SizedBox(height: LbSpace.gap),
            const SectionLabel('Portfolio heat'),
            const SizedBox(height: 6),
            BarStrip(
              value: heat,
              max: cap != null && cap > 0 ? cap : heat * 1.2,
              marker: cap != null && cap > 0 ? cap : null,
              tone: cap != null && heat >= cap ? ChartTone.warn : ChartTone.primary,
              semanticsLabel: cap != null
                  ? 'Portfolio heat ${heat.toStringAsFixed(1)}% of a ${cap.toStringAsFixed(1)}% cap'
                  : 'Portfolio heat ${heat.toStringAsFixed(1)}%',
            ),
            const SizedBox(height: 4),
            Text(
              cap != null
                  ? '${heat.toStringAsFixed(1)}% of ${cap.toStringAsFixed(1)}% cap'
                  : '${heat.toStringAsFixed(1)}%',
              style: LbText.number(
                context,
                size: 11.5,
                color: context.lb.mutedForeground,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ExposureRowView extends StatelessWidget {
  const _ExposureRowView({required this.row});

  final ExposureRow row;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final risk = row.riskToStopPct;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              TickerLink(row.symbol),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  row.sector ?? '',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: LbText.muted(context, size: 12),
                ),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerRight,
                  child: PctText(row.weightPct, size: 13),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            runSpacing: 2,
            children: [
              Pnl(amount: row.unrealizedPnl, size: 12.5),
              Text(
                'stop ${row.stopPrice == null ? '—' : usd(row.stopPrice!)}',
                style: LbText.number(
                  context,
                  size: 12,
                  color: c.mutedForeground,
                ),
              ),
              Text(
                'risk ${risk == null ? '—' : pctSigned(risk)}',
                style: LbText.number(
                  context,
                  size: 12,
                  color: risk == null
                      ? c.mutedForeground
                      : risk > 0
                          ? c.warn
                          : c.mutedForeground,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Sector weights against the per-sector cap.
class _SectorsPanel extends StatelessWidget {
  const _SectorsPanel({required this.summary, required this.risk});

  final PerformanceSummary summary;
  final RiskConfig? risk;

  @override
  Widget build(BuildContext context) {
    final sectors = summary.sectors;
    final cap = risk?.maxSectorPct;
    final reading = sectors.isEmpty
        ? null
        : cap != null
            ? '${sectors.first.sector} is the largest at ${sectors.first.weightPct.toStringAsFixed(1)}% (cap ${cap.toStringAsFixed(0)}%)'
            : '${sectors.first.sector} is the largest at ${sectors.first.weightPct.toStringAsFixed(1)}%';
    return Panel(
      title: 'Sector weights',
      reading: reading,
      child: sectors.isEmpty
          ? const Empty(
              title: 'No sector weights',
              message: 'Sector concentration will tally here.',
            )
          : BarStripList(
              rows: sectors
                  .map(
                    (s) => BarRow(
                      label: s.sector,
                      value: s.weightPct,
                      valueLabel: '${s.weightPct.toStringAsFixed(1)}%',
                      marker: cap,
                    ),
                  )
                  .toList(),
            ),
    );
  }
}
