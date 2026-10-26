import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';

import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/reports_calc.dart'
    show
        figureStrip,
        kindLabel,
        periodReading,
        planOutcomeRows,
        reportPeriodShort,
        reportPeriodWords,
        tradeMarkerDates;
import 'package:longbow/models/models.dart';

import '../shared/shared.dart';
import 'report_pdf.dart';
import 'report_share.dart';

ChartTone _chartTone(Tone t) => switch (t) {
  Tone.gain => ChartTone.gain,
  Tone.loss => ChartTone.loss,
  Tone.flat => ChartTone.muted,
};

/// The full report brief: headline, summary, grade, figure strip, equity or
/// price-path chart, plan versus outcome, trades, positions, orders, decisions
/// and narrative. Port of the web `ReportView`.
class ReportPage extends ConsumerStatefulWidget {
  const ReportPage({super.key, required this.id});

  final String id;

  @override
  ConsumerState<ReportPage> createState() => _ReportPageState();
}

class _ReportPageState extends ConsumerState<ReportPage> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(harnessProvider.notifier).loadReport(widget.id),
    );
  }

  Future<void> _reload() =>
      ref.read(harnessProvider.notifier).loadReport(widget.id, force: true);

  Future<void> _share(Report r) => SharePlus.instance.share(
    ShareParams(text: reportShareText(r), subject: r.headline),
  );

  Future<void> _print(Report r) => Printing.layoutPdf(
    name: '${r.headline}.pdf',
    onLayout: (_) => buildReportPdf(r),
  );

  @override
  Widget build(BuildContext context) {
    final loadable = ref.watch(
      harnessProvider.select((s) => s.reportDetail[widget.id]),
    );
    final offline =
        ref.watch(harnessProvider.select((s) => s.connection)) ==
        ConnectionStatus.offline;
    final report = loadable?.data;

    if (report == null) {
      return LbPageScaffold(
        title: 'Report',
        banner:
            offline ? StaleBanner(offline: true, onRetry: _reload) : null,
        slivers: [
          if (loadable?.state == LoadState.error)
            SliverToBoxAdapter(child: _ReportError(error: loadable?.error ?? '', onRetry: _reload))
          else
            const SliverToBoxAdapter(child: _ReportSkeleton()),
        ],
      );
    }

    final r = report;
    final kind = kindLabel[r.kind] ?? 'Report';
    return LbPageScaffold(
      title: '$kind report',
      onRefresh: _reload,
      banner: offline ? StaleBanner(offline: true, onRetry: _reload) : null,
      actions: [
        IconButton(
          tooltip: 'Share report',
          onPressed: () => _share(r),
          icon: const LbIcon(LbIcons.share01),
        ),
        IconButton(
          tooltip: 'Print report',
          onPressed: () => _print(r),
          icon: const LbIcon(LbIcons.printer),
        ),
      ],
      slivers: [
        if (loadable?.error != null)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                'Could not refresh: ${loadable!.error}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: context.lb.warn,
                ),
              ),
            ),
          ),
        ..._body(context, r),
      ],
    );
  }

  List<Widget> _body(BuildContext context, Report r) {
    final f = r.facts;
    final figs = figureStrip(f);
    final children = <Widget>[
      _Header(report: r),
      if (figs.isNotEmpty)
        LbCard(
          child: Wrap(
            spacing: 28,
            runSpacing: 12,
            children: [
              for (final fig in figs)
                Stat(
                  label: fig.label,
                  value: fig.value,
                  sub: fig.sub,
                  tone: fig.tone,
                ),
            ],
          ),
        ),
      if (r.grade != null) _GradeCard(report: r),
      if (r.kind == ReportKind.trade && f.trade != null) ...[
        _PricePath(report: r),
        _PlanTable(report: r),
        if (f.trade!.plan != null)
          Panel(
            title: 'Original thesis',
            child: LbMarkdown(f.trade!.plan!.thesis),
          ),
      ] else ...[
        _EquityPanel(report: r),
        _ClosedTrades(report: r),
        if (f.positions.isNotEmpty) _Positions(report: r),
        _OrdersSummary(report: r),
        if (f.decisions.isNotEmpty) _Decisions(report: r),
      ],
      for (final s in r.narrative.sections)
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text(
                s.title,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            const SizedBox(height: 8),
            LbCard(
              child: SizedBox(
                width: double.infinity,
                child: LbMarkdown(s.body),
              ),
            ),
          ],
        ),
      if (r.narrative.lessons.isNotEmpty ||
          r.narrative.nextSteps.isNotEmpty)
        _LessonsNext(report: r),
      _Footer(report: r),
    ];
    return [
      SliverList.separated(
        itemCount: children.length,
        separatorBuilder: (_, _) => const SizedBox(height: LbSpace.gap),
        itemBuilder: (_, i) => children[i],
      ),
    ];
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    final r = report;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          runSpacing: 2,
          children: [
            Text(
              '${(kindLabel[r.kind] ?? r.kind.name).toUpperCase()} REPORT',
              style: LbText.caption(
                context,
              ).copyWith(fontWeight: FontWeight.w600),
            ),
            Text(
              reportPeriodWords(r.kind, r.periodStart, r.periodEnd),
              style: LbText.number(
                context,
                size: 12,
                color: context.lb.mutedForeground,
              ),
            ),
            if (r.kind == ReportKind.trade && r.symbol != null)
              TickerLink(r.symbol!),
          ],
        ),
        const SizedBox(height: 8),
        Text(r.headline, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        LbMarkdown(r.narrative.summary),
        const SizedBox(height: 6),
        Text(
          'Published ${ago(r.at)}',
          style: LbText.number(
            context,
            size: 11.5,
            color: context.lb.mutedForeground,
          ),
        ),
      ],
    );
  }
}

class _GradeCard extends StatelessWidget {
  const _GradeCard({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    final reason =
        report.narrative.gradeReason ?? 'Judged apart from the outcome.';
    return LbCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GradeChip(
            report.grade!.name.toUpperCase(),
            large: true,
            reason: reason,
          ),
          const SizedBox(width: LbSpace.gap),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionLabel('Decision grade'),
                const SizedBox(height: 2),
                Text(reason, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PricePath extends StatelessWidget {
  const _PricePath({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    final t = report.facts.trade!;
    final bars = t.bars;
    if (bars.isEmpty) {
      return const Panel(
        title: 'Price path',
        child: Empty(title: 'No price bars for this trade.'),
      );
    }
    final at = tradeMarkerDates(
      bars,
      t.trade.openedAt,
      t.trade.closedAt,
      t.plan?.timeStopDate,
    );
    int indexOf(String? date) =>
        date == null ? -1 : bars.indexWhere((b) => b.date == date);
    final markers = <ChartMarker>[];
    final entry = indexOf(at.entry);
    if (entry >= 0) {
      markers.add(
        ChartMarker(index: entry, kind: ChartMarkerKind.buy, label: 'Entry'),
      );
    }
    final exit = indexOf(at.exit);
    if (exit >= 0) {
      markers.add(
        ChartMarker(index: exit, kind: ChartMarkerKind.sell, label: 'Exit'),
      );
    }
    final timeStop = indexOf(at.timeStop);
    if (timeStop >= 0) {
      markers.add(
        ChartMarker(
          index: timeStop,
          kind: ChartMarkerKind.neutral,
          label: 'Time stop',
        ),
      );
    }
    final won = t.trade.pnl >= 0;
    final marks = markers.map((m) => m.label.toLowerCase()).join(', ');
    final c = context.lb;
    return Panel(
      title: 'Price path',
      reading:
          'Daily bars from ${isoShort(bars.first.date)} to ${isoShort(bars.last.date)}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CandleChart(
            bars: [
              for (final b in bars)
                CandleBar(
                  open: b.open,
                  high: b.high,
                  low: b.low,
                  close: b.close,
                  volume: b.volume,
                ),
            ],
            labels: [for (final b in bars) b.date],
            referenceLines: [
              if (t.plan != null)
                ChartReferenceLine(
                  value: t.plan!.invalidationPrice,
                  label: 'Stop ${usd(t.plan!.invalidationPrice)}',
                  tone: ChartTone.loss,
                ),
            ],
            markers: markers,
            valueFormatter: (v) => usd(v),
            height: 280,
            semanticsLabel:
                '${report.symbol ?? 'Trade'} price path'
                '${marks.isEmpty ? '' : ' with $marks marks'}'
                '${t.plan == null ? '' : ' and stop line'}',
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 16,
            runSpacing: 4,
            children: [
              if (entry >= 0)
                _LegendDot(color: c.primary, label: 'Entry'),
              _LegendDot(
                color: won ? c.gain : c.loss,
                label: 'Exit',
              ),
              if (t.plan != null) _LegendDash(color: c.loss, label: 'Invalidation'),
              if (timeStop >= 0)
                _LegendDot(color: c.mutedForeground, label: 'Time stop'),
            ],
          ),
        ],
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(label, style: LbText.muted(context, size: 11.5)),
      ],
    );
  }
}

class _LegendDash extends StatelessWidget {
  const _LegendDash({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 16, height: 2, color: color),
        const SizedBox(width: 6),
        Text(label, style: LbText.muted(context, size: 11.5)),
      ],
    );
  }
}

class _PlanTable extends StatelessWidget {
  const _PlanTable({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    final rows = planOutcomeRows(report);
    final c = context.lb;
    TextStyle num([Color? color]) =>
        LbText.number(context, size: 13, color: color);
    Widget cell(String text, {bool right = false, Color? color}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text(text, textAlign: right ? TextAlign.end : null, style: num(color)),
    );
    return Panel(
      title: 'Plan versus outcome',
      padChild: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          LbSpace.card,
          0,
          LbSpace.card,
          LbSpace.card,
        ),
        child: Table(
          columnWidths: const {
            0: FlexColumnWidth(1.1),
            1: FlexColumnWidth(1),
            2: FlexColumnWidth(1.2),
          },
          border: TableBorder(
            horizontalInside: BorderSide(color: c.border),
          ),
          children: [
            TableRow(
              children: [
                cell('Measure', color: c.mutedForeground),
                cell('Plan', right: true, color: c.mutedForeground),
                cell('Outcome', right: true, color: c.mutedForeground),
              ],
            ),
            for (final row in rows)
              TableRow(
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text(
                      row.label,
                      style: LbText.muted(context),
                    ),
                  ),
                  cell(row.planned, right: true),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          row.realized,
                          textAlign: TextAlign.end,
                          style: num().copyWith(fontWeight: FontWeight.w600),
                        ),
                        if (row.fees != null)
                          Text(
                            'incl. ${usd(row.fees!)} fees',
                            textAlign: TextAlign.end,
                            style: LbText.number(
                              context,
                              size: 11,
                              color: c.mutedForeground,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _EquityPanel extends StatelessWidget {
  const _EquityPanel({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    final r = report;
    final f = r.facts;
    final reading = periodReading(f);
    if (r.kind == ReportKind.daily) {
      final pnlPct = f.pnlPct;
      final bench = f.benchmarkPct;
      if (pnlPct == null || bench == null) {
        return const Panel(
          title: 'Day move versus SPY',
          child: Empty(title: 'No market comparison recorded for this day.'),
        );
      }
      final acctTone = _chartTone(tone(pnlPct));
      return Panel(
        title: 'Day move versus SPY',
        reading: reading,
        child: ColumnChart(
          categories: const ['Account', 'SPY'],
          series: [
            ColumnSeries(
              values: [pnlPct, 0],
              name: 'Account',
              tone: acctTone,
            ),
            ColumnSeries(
              values: [0, bench],
              name: 'SPY',
              tone: ChartTone.muted,
            ),
          ],
          valueFormatter: (v) => pctSigned(v),
          height: 180,
          semanticsLabel:
              'Day move: account ${pctSigned(pnlPct)} against SPY ${pctSigned(bench)}',
        ),
      );
    }
    final curve = f.equityCurve;
    if (curve.length < 2) {
      return const Panel(
        title: 'Equity versus SPY',
        child: Empty(
          title: 'Equity marks are recorded once a day. This week has a single mark so far.',
        ),
      );
    }
    return Panel(
      title: 'Equity versus SPY',
      reading: reading,
      child: DitherAreaChart(
        values: [for (final p in curve) p.value],
        labels: [for (final p in curve) p.date],
        name: 'Account',
        valueFormatter: (v) => usd(v),
        height: 220,
        semanticsLabel: 'Account equity over the week.${reading == null ? '' : ' $reading'}',
      ),
    );
  }
}

class _ClosedTrades extends StatelessWidget {
  const _ClosedTrades({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    final trades =
        report.facts.trades.toList()
          ..sort((a, b) => b.closedAt.compareTo(a.closedAt));
    if (trades.isEmpty) {
      return const Panel(
        title: 'Closed trades',
        child: Empty(title: 'No trades closed in this period.'),
      );
    }
    final c = context.lb;
    return Panel(
      title: 'Closed trades',
      reading: 'Newest first',
      child: Column(
        children: [
          for (var i = 0; i < trades.length; i++) ...[
            if (i > 0) Divider(height: 17, color: c.border),
            _TradeRow(trade: trades[i]),
          ],
        ],
      ),
    );
  }
}

class _TradeRow extends StatelessWidget {
  const _TradeRow({required this.trade});

  final ClosedTrade trade;

  @override
  Widget build(BuildContext context) {
    final t = trade;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            TickerLink(t.symbol),
            const SizedBox(width: 8),
            Text(
              isoShort(etDayKey(t.closedAt)),
              style: LbText.number(
                context,
                size: 11.5,
                color: context.lb.mutedForeground,
              ),
            ),
            const Spacer(),
            StatusChip(
              t.source == TradeSource.harness ? 'Longbow' : 'Robinhood history',
              showIcon: false,
            ),
          ],
        ),
        const SizedBox(height: 4),
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 12,
          runSpacing: 2,
          children: [
            Pnl(amount: t.pnl, percent: t.pnlPct, size: 13),
            Text(
              t.rMultiple == null
                  ? '\u2014'
                  : '${t.rMultiple! >= 0 ? '+' : '\u2212'}${t.rMultiple!.abs().toStringAsFixed(1)}R',
              style: LbText.number(
                context,
                size: 13,
                color:
                    t.rMultiple == null
                        ? context.lb.mutedForeground
                        : context.lb.forTone(tone(t.rMultiple!)),
              ),
            ),
            if (t.fees != null && t.fees! > 0)
              Text(
                'incl. ${usd(t.fees!)} fees',
                style: LbText.number(
                  context,
                  size: 11,
                  color: context.lb.mutedForeground,
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _Positions extends StatelessWidget {
  const _Positions({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    final positions =
        report.facts.positions.toList()
          ..sort((a, b) => b.weightPct.compareTo(a.weightPct));
    final peak = positions.fold<double>(
      30,
      (m, p) => p.weightPct > m ? p.weightPct : m,
    );
    return Panel(
      title: 'Positions at the end of the period',
      child: BarStripList(
        rows: [
          for (final p in positions)
            BarRow(
              label: p.symbol,
              value: p.weightPct,
              valueLabel: pct(p.weightPct),
              tone:
                  p.unrealizedPnl >= 0 ? ChartTone.gain : ChartTone.loss,
            ),
        ],
        max: peak,
      ),
    );
  }
}

class _OrdersSummary extends StatelessWidget {
  const _OrdersSummary({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    // Trade reports carry an all-zero tally, not a period summary.
    if (report.kind == ReportKind.trade) return const SizedBox.shrink();
    final o = report.facts.orders;
    return Panel(
      title: 'Orders',
      reading: 'Submitted versus completed in the period',
      child: Wrap(
        spacing: 28,
        runSpacing: 12,
        children: [
          Stat(label: 'Submitted', value: '${o.submitted}'),
          Stat(label: 'Filled', value: '${o.filled}'),
          Stat(label: 'Rejected', value: '${o.rejected}'),
          Stat(label: 'Cancelled', value: '${o.cancelled}'),
          Stat(label: 'Failed', value: '${o.failed}'),
        ],
      ),
    );
  }
}

class _Decisions extends StatelessWidget {
  const _Decisions({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final decisions = report.facts.decisions;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionLabel('Decisions'),
        const SizedBox(height: 8),
        LbCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              for (var i = 0; i < decisions.length; i++) ...[
                if (i > 0) Divider(height: 1, color: c.border),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: LbSpace.card,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      ActionBadge(decisions[i].action.name),
                      if (decisions[i].symbol != null) ...[
                        const SizedBox(width: 8),
                        TickerLink(decisions[i].symbol!),
                      ],
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          decisions[i].summary,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        ago(decisions[i].at),
                        style: LbText.number(
                          context,
                          size: 11.5,
                          color: c.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _LessonsNext extends StatelessWidget {
  const _LessonsNext({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    Widget list(String title, List<String> items, {required bool next}) {
      final c = context.lb;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionLabel(title),
          const SizedBox(height: 8),
          LbCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < items.length; i++) ...[
                  if (i > 0) const SizedBox(height: 8),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        next ? '\u2192' : '\u2014',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: next ? c.primary : c.mutedForeground,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          items[i],
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            height: 1.4,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      );
    }

    final lessons = report.narrative.lessons;
    final next = report.narrative.nextSteps;
    return LayoutBuilder(
      builder: (context, box) {
        if (box.maxWidth >= 560 &&
            lessons.isNotEmpty &&
            next.isNotEmpty) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: list('Lessons', lessons, next: false)),
              const SizedBox(width: LbSpace.gap),
              Expanded(child: list('Next', next, next: true)),
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (lessons.isNotEmpty) list('Lessons', lessons, next: false),
            if (lessons.isNotEmpty && next.isNotEmpty)
              const SizedBox(height: LbSpace.gap),
            if (next.isNotEmpty) list('Next', next, next: true),
          ],
        );
      },
    );
  }
}

class _Footer extends StatelessWidget {
  const _Footer({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context) {
    final r = report;
    final f = r.facts;
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 8,
      runSpacing: 2,
      children: [
        Text(
          reportPeriodShort(r.kind, r.periodStart, r.periodEnd),
          style: LbText.number(
            context,
            size: 11.5,
            color: context.lb.mutedForeground,
          ),
        ),
        Pnl(amount: f.pnl ?? 0, percent: f.pnlPct, size: 12),
        if (f.realizedPnl != 0 && (f.pnl ?? 0) != f.realizedPnl)
          Text(
            'realized ${usdSigned(f.realizedPnl)}',
            style: LbText.number(
              context,
              size: 11.5,
              color: context.lb.mutedForeground,
            ),
          ),
      ],
    );
  }
}

class _ReportSkeleton extends StatelessWidget {
  const _ReportSkeleton();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SkeletonBlock(width: 200, height: 14),
        SizedBox(height: 8),
        SkeletonBlock(height: 28),
        SizedBox(height: 8),
        SkeletonLines(lines: 2),
        SizedBox(height: LbSpace.gap),
        SkeletonBlock(height: 110),
        SizedBox(height: LbSpace.gap),
        SkeletonBlock(height: 260),
      ],
    );
  }
}

class _ReportError extends StatelessWidget {
  const _ReportError({required this.error, required this.onRetry});

  final String error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final notFound = error.toLowerCase().contains('not found');
    return ErrorState(
      title: notFound ? 'Report not available' : 'Something went wrong',
      message:
          notFound
              ? 'This report is no longer available.'
              : 'Could not load this report: $error',
      onRetry: onRetry,
    );
  }
}
