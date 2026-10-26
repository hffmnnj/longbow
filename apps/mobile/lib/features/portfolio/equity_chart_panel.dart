import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/analytics_calc.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'portfolio_logic.dart';

/// Whole dollars when the value is round (axis ticks), cents otherwise.
String _equityLabel(double v) => (v - v.roundToDouble()).abs() < 0.005 ? usd0(v) : usd(v);

const double equityChartHeight = 200;

/// Equity against SPY over a selectable range, with the plain-language
/// reading, and the holdings replay as the web shows it.
class EquityChartPanel extends ConsumerStatefulWidget {
  const EquityChartPanel({super.key, required this.range, required this.onRangeChanged});

  final AnalyticsRange range;
  final ValueChanged<AnalyticsRange> onRangeChanged;

  @override
  ConsumerState<EquityChartPanel> createState() => _EquityChartPanelState();
}

class _EquityChartPanelState extends ConsumerState<EquityChartPanel> {
  EquityHistory? _last;
  bool _replay = false;

  static const _ranges = <LbSegment<AnalyticsRange>>[
    LbSegment(AnalyticsRange.oneMonth, '1M'),
    LbSegment(AnalyticsRange.threeMonths, '3M'),
    LbSegment(AnalyticsRange.oneYear, '1Y'),
    LbSegment(AnalyticsRange.all, 'All'),
  ];

  void _retry() => ref.read(harnessProvider.notifier).loadEquity(widget.range, force: true);

  @override
  Widget build(BuildContext context) {
    final load = ref.watch(harnessProvider.select((s) => s.equity[analyticsRangeWire(widget.range)]));
    final fresh = load?.data;
    if (fresh != null) _last = fresh;
    // A new range with nothing loaded yet keeps the previous chart on screen.
    final data = fresh ?? (load?.state == LoadState.error ? null : _last);
    final switching = fresh == null && data != null;
    final canReplay = (data?.holdingsReplay.length ?? 0) > 1;

    return Panel(
      title: _replay && canReplay ? replayLabel : 'Equity vs SPY',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              LbSegmented<AnalyticsRange>(
                segments: _ranges,
                selected: widget.range,
                onChanged: widget.onRangeChanged,
                semanticLabel: 'Range',
              ),
              if (canReplay)
                LbSegmented<bool>(
                  segments: const [LbSegment(false, 'Account'), LbSegment(true, 'Replay')],
                  selected: _replay,
                  onChanged: (v) => setState(() => _replay = v),
                  semanticLabel: 'Equity series',
                ),
            ],
          ),
          const SizedBox(height: LbSpace.gap),
          if (data == null)
            LoadableView<EquityHistory>(
              loadable: load,
              onRetry: _retry,
              skeletonHeight: equityChartHeight + 56,
              builder: (context, h) => const SizedBox.shrink(),
            )
          else
            AnimatedOpacity(
              opacity: switching ? 0.5 : 1,
              duration: LbMotion.duration(context),
              child: _Body(history: data, replay: _replay, loadingNote: switching ? 'Loading ${_ranges.firstWhere((r) => r.value == widget.range).label}\u2026' : null),
            ),
          if (load?.error != null && data != null && !switching)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('Could not refresh: ${load!.error}', style: LbText.caption(context, color: context.lb.warn)),
            ),
        ],
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.history, required this.replay, this.loadingNote});

  final EquityHistory history;
  final bool replay;
  final String? loadingNote;

  @override
  Widget build(BuildContext context) {
    final eq = equityRows(history);
    final rep = replayRows(history);
    final showReplay = replay || (eq.rows.length < 2 && rep.length > 1);
    final t = Theme.of(context).textTheme;
    final c = context.lb;

    Widget content;
    if (showReplay) {
      if (rep.length > 1) {
        final reading = replayReading(history);
        content = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (reading != null) Text(reading, style: t.bodyMedium),
            const SizedBox(height: 4),
            Text(replayNote, style: LbText.muted(context, size: 12)),
            const SizedBox(height: LbSpace.gap),
            DitherAreaChart(
              values: [for (final r in rep) r.value],
              labels: [for (final r in rep) isoShort(r.date)],
              name: 'Replay',
              tone: ChartTone.muted,
              valueFormatter: _equityLabel,
              height: equityChartHeight,
              semanticsLabel: "$replayLabel: portfolio value if you had held today's positions. ${reading ?? ''}",
            ),
          ],
        );
      } else {
        content = Text("Not enough price history to replay today's holdings yet.", style: LbText.muted(context));
      }
    } else if (eq.rows.length >= 2) {
      final reading = equityVsSpyReading(history);
      final dd = history.maxDrawdownPct;
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (reading != null)
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: reading),
                  if (dd != null)
                    TextSpan(
                      text: ' \u00b7 max drawdown ${pct(dd.abs())}',
                      style: LbText.number(context, size: 12, color: c.mutedForeground),
                    ),
                ],
              ),
              style: t.bodyMedium,
            ),
          const SizedBox(height: LbSpace.gap),
          DitherAreaChart(
            values: [for (final r in eq.rows) r.equity],
            labels: [for (final r in eq.rows) isoShort(r.date)],
            benchmark: eq.hasBenchmark ? [for (final r in eq.rows) r.benchmark ?? 0] : null,
            name: 'Account',
            benchmarkName: 'SPY',
            valueFormatter: _equityLabel,
            height: equityChartHeight,
            semanticsLabel: 'Account equity against SPY. ${reading ?? ''}',
          ),
          const SizedBox(height: 8),
          Text(
            eq.hasBenchmark ? 'Solid line is the account; dashed is SPY from the same start.' : 'Solid line is the account.',
            style: LbText.caption(context),
          ),
        ],
      );
    } else {
      content = Text(
        'Equity marks are recorded once a day. The first chart appears after the second mark.',
        style: LbText.muted(context),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        content,
        if (loadingNote != null)
          Padding(padding: const EdgeInsets.only(top: 6), child: Text(loadingNote!, style: LbText.caption(context))),
      ],
    );
  }
}
