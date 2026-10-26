import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/analytics_calc.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'trend_list.dart';

/// Analytic dashboard for the market backdrop: regime first, then the trend
/// lists, volatility and yields, and the week ahead. Every block reads the
/// same [MarketOverview] loadable independently, so one slow panel never
/// blocks the others and stale figures stay visible while a refresh runs.
class MarketsScreen extends ConsumerStatefulWidget {
  const MarketsScreen({super.key});

  @override
  ConsumerState<MarketsScreen> createState() => _MarketsScreenState();
}

enum TrendTab { indices, sectors }

class _MarketsScreenState extends ConsumerState<MarketsScreen> {
  TrendTab _tab = TrendTab.indices;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (!mounted) return;
      ref.read(harnessProvider.notifier).loadMarket();
    });
  }

  Future<void> _refresh() =>
      ref.read(harnessProvider.notifier).loadMarket(force: true);

  @override
  Widget build(BuildContext context) {
    final market = ref.watch(harnessProvider.select((s) => s.market));
    final offline = ref.watch(
      harnessProvider.select((s) => s.connection == ConnectionStatus.offline),
    );
    final held = ref.watch(positionsProvider).map((p) => p.symbol).toSet();
    return LbTabBody.children(
      onRefresh: _refresh,
      children: [
        if (offline)
          StaleBanner(
            offline: true,
            updatedAtMs: market.at,
            onRetry: _refresh,
          ),
        LoadableView<MarketOverview>(
          loadable: market,
          onRetry: _refresh,
          skeletonHeight: 248,
          builder: (context, m) => _RegimeBlock(data: m),
        ),
        LoadableView<MarketOverview>(
          loadable: market,
          onRetry: _refresh,
          skeletonHeight: 340,
          builder: (context, m) => _TrendBlock(
            data: m,
            tab: _tab,
            held: held,
            onTab: (t) => setState(() => _tab = t),
          ),
        ),
        LoadableView<MarketOverview>(
          loadable: market,
          onRetry: _refresh,
          skeletonHeight: 420,
          builder: (context, m) => _VolYieldBlock(data: m),
        ),
        LoadableView<MarketOverview>(
          loadable: market,
          onRetry: _refresh,
          skeletonHeight: 300,
          builder: (context, m) => _WeekAheadBlock(data: m, held: held),
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

/// The regime sentence prominently, with the four headline figures beneath it.
class _RegimeBlock extends StatelessWidget {
  const _RegimeBlock({required this.data});

  final MarketOverview data;

  @override
  Widget build(BuildContext context) {
    final vol = data.volatility;
    final tenY = data.yields.where((y) => y.tenor == '10Y').firstOrNull;
    final breadth = breadthPct(data.breadth);
    final stats = <Widget>[
      Stat(
        label: 'VIX',
        value: vol.vix.toStringAsFixed(1),
        sub: vol.percentile == null
            ? null
            : '${vol.percentile!.round()}th percentile, 1Y',
      ),
      Stat(
        label: 'Term structure',
        value: vol.contango ? 'Contango' : 'Backwardation',
        sub: vol.contango ? 'Calm near term' : 'Stress near term',
        tone: vol.contango ? Tone.flat : Tone.loss,
      ),
      Stat(
        label: '10Y yield',
        value: tenY == null ? null : yieldPct(tenY.yieldPct),
      ),
      _BreadthStat(data: data, breadth: breadth),
    ];
    return Panel(
      title: 'Regime',
      reading: data.regime,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          LayoutBuilder(builder: (context, box) {
            final cols = box.maxWidth >= 600 ? 4 : 2;
            final rows = <Widget>[];
            for (var i = 0; i < stats.length; i += cols) {
              final slice = stats.sublist(
                i,
                (i + cols).clamp(0, stats.length),
              );
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
          const SizedBox(height: 8),
          Text(
            'Data as of ${ago(data.asOf)}',
            style: LbText.muted(context, size: 11.5),
          ),
        ],
      ),
    );
  }
}

class _BreadthStat extends StatelessWidget {
  const _BreadthStat({required this.data, required this.breadth});

  final MarketOverview data;
  final double breadth;

  @override
  Widget build(BuildContext context) {
    final tone = breadth >= 60
        ? ChartTone.gain
        : breadth >= 40
            ? ChartTone.primary
            : ChartTone.loss;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionLabel('Breadth'),
        const SizedBox(height: 2),
        Text(
          pct(breadth),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: LbText.number(context, size: 17, weight: FontWeight.w600),
        ),
        const SizedBox(height: 6),
        BarStrip(
          value: breadth,
          marker: 50,
          tone: tone,
          semanticsLabel:
              '${data.breadth.aboveSma50} of ${data.breadth.total} stocks above their 50 day average',
        ),
        const SizedBox(height: 4),
        Text(
          '${data.breadth.aboveSma50} of ${data.breadth.total} above 50d',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: LbText.number(context, size: 11.5, color: context.lb.mutedForeground),
        ),
      ],
    );
  }
}

/// Indices and Sectors behind a segment; rows answer "up or down, and since
/// when" before the evidence.
class _TrendBlock extends StatelessWidget {
  const _TrendBlock({
    required this.data,
    required this.tab,
    required this.held,
    required this.onTab,
  });

  final MarketOverview data;
  final TrendTab tab;
  final Set<String> held;
  final ValueChanged<TrendTab> onTab;

  @override
  Widget build(BuildContext context) {
    final rows = tab == TrendTab.indices ? data.indices : data.sectors;
    final relative = tab == TrendTab.sectors;
    final String? reading;
    if (tab == TrendTab.indices) {
      final above = rows.where((r) => r.aboveSma50).length;
      reading = '$above of ${rows.length} above their 50 day average';
    } else if (rows.isEmpty) {
      reading = null;
    } else {
      final first = rows.first;
      final last = rows.last;
      reading =
          '${first.name ?? first.symbol} leads SPY over 3 months; ${last.name ?? last.symbol} trails';
    }
    return Panel(
      title: tab == TrendTab.indices ? 'Indices' : 'Sectors',
      reading: reading,
      actions: ConstrainedBox(
        // Panel's header row is unbounded: bound the control so its
        // horizontal scroll engages at large text scales instead of
        // overflowing. 240 keeps the 1x size (~231) untouched.
        constraints: const BoxConstraints(maxWidth: 240),
        child: LbSegmented<TrendTab>(
          semanticLabel: 'Trend list',
          segments: const [
            LbSegment(TrendTab.indices, 'Indices'),
            LbSegment(TrendTab.sectors, 'Sectors'),
          ],
          selected: tab,
          onChanged: onTab,
        ),
      ),
      child: TrendList(rows: rows, relative: relative, held: held),
    );
  }
}

/// Volatility and the yield curve, side by side where there is room.
class _VolYieldBlock extends StatelessWidget {
  const _VolYieldBlock({required this.data});

  final MarketOverview data;

  @override
  Widget build(BuildContext context) {
    return _twoCol(
      context,
      _VolatilityPanel(data: data),
      _YieldPanel(data: data),
    );
  }
}

class _VolatilityPanel extends StatelessWidget {
  const _VolatilityPanel({required this.data});

  final MarketOverview data;

  @override
  Widget build(BuildContext context) {
    final vol = data.volatility;
    final history = vol.history;
    final termRows = <BarRow>[];
    if (vol.vix9d != null && vol.vix3m != null) {
      final top = [vol.vix9d!, vol.vix, vol.vix3m!]
          .reduce((a, b) => a > b ? a : b);
      termRows.addAll([
        BarRow(
          label: '9 day',
          value: vol.vix9d!,
          valueLabel: vol.vix9d!.toStringAsFixed(1),
          tone: ChartTone.warn,
        ),
        BarRow(
          label: '30 day (VIX)',
          value: vol.vix,
          valueLabel: vol.vix.toStringAsFixed(1),
          tone: ChartTone.warn,
        ),
        BarRow(
          label: '3 month',
          value: vol.vix3m!,
          valueLabel: vol.vix3m!.toStringAsFixed(1),
          tone: ChartTone.warn,
        ),
      ]);
      return Panel(
        title: 'Volatility',
        reading: vixReading(vol),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (history.isNotEmpty)
              DitherAreaChart(
                values: history.map((h) => h.value).toList(),
                labels: history.map((h) => h.date).toList(),
                tone: ChartTone.warn,
                name: 'VIX',
                valueFormatter: (v) => v.toStringAsFixed(1),
                height: 176,
                semanticsLabel:
                    'VIX over ${history.length} trading days, now ${vol.vix.toStringAsFixed(1)}',
              )
            else
              const Empty(
                title: 'No volatility history',
                message: 'The VIX path will draw once history arrives.',
              ),
            const SizedBox(height: LbSpace.gap),
            const SectionLabel('Term structure'),
            const SizedBox(height: 6),
            BarStripList(
              rows: termRows,
              max: top * 1.1,
              labelWidth: 96,
              valueWidth: 44,
            ),
          ],
        ),
      );
    }
    return Panel(
      title: 'Volatility',
      reading: vixReading(vol),
      child: history.isEmpty
          ? const Empty(
              title: 'No volatility history',
              message: 'The VIX path will draw once history arrives.',
            )
          : DitherAreaChart(
              values: history.map((h) => h.value).toList(),
              labels: history.map((h) => h.date).toList(),
              tone: ChartTone.warn,
              name: 'VIX',
              valueFormatter: (v) => v.toStringAsFixed(1),
              height: 176,
              semanticsLabel:
                  'VIX over ${history.length} trading days, now ${vol.vix.toStringAsFixed(1)}',
            ),
    );
  }
}

class _YieldPanel extends StatelessWidget {
  const _YieldPanel({required this.data});

  final MarketOverview data;

  @override
  Widget build(BuildContext context) {
    final yields = data.yields;
    final history = data.tenYearHistory;
    return Panel(
      title: 'Yield curve',
      reading: yieldReading(yields),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (yields.isNotEmpty)
            CurveChart(
              labels: yields.map((y) => y.tenor).toList(),
              values: yields.map((y) => y.yieldPct).toList(),
              name: 'Treasury yield',
              valueFormatter: yieldPct,
              height: 150,
              semanticsLabel:
                  'Treasury yield curve from ${yields.first.tenor} to ${yields.last.tenor}',
            )
          else
            const Empty(
              title: 'No yield curve',
              message: 'Treasury yields will draw once they arrive.',
            ),
          const SizedBox(height: LbSpace.gap),
          SectionLabel('10-year yield, ${history.length} days'),
          const SizedBox(height: 6),
          if (history.isNotEmpty)
            DitherAreaChart(
              values: history.map((h) => h.value).toList(),
              labels: history.map((h) => h.date).toList(),
              tone: ChartTone.lab,
              name: '10Y yield',
              valueFormatter: yieldPct,
              height: 132,
              semanticsLabel: 'Ten year Treasury yield history',
            )
          else
            const Empty(
              title: 'No 10-year history',
              message: 'The 10-year path will draw once history arrives.',
            ),
        ],
      ),
    );
  }
}

/// The economic calendar and upcoming earnings, side by side where there is
/// room. Held names carry a chip so personal exposure reads at a glance.
class _WeekAheadBlock extends StatelessWidget {
  const _WeekAheadBlock({required this.data, required this.held});

  final MarketOverview data;
  final Set<String> held;

  @override
  Widget build(BuildContext context) {
    return _twoCol(
      context,
      _CalendarPanel(data: data),
      _EarningsPanel(data: data, held: held),
    );
  }
}

class _CalendarPanel extends StatelessWidget {
  const _CalendarPanel({required this.data});

  final MarketOverview data;

  @override
  Widget build(BuildContext context) {
    final days = groupCalendarDays<CalendarEvent>(
      data.calendar,
      (c) => c.date,
    );
    final high = data.calendar
        .where((c) => c.importance == CalendarImportance.high)
        .length;
    return Panel(
      title: 'Economic calendar',
      reading: data.calendar.isEmpty
          ? null
          : '$high high-impact releases in the next 7 days',
      child: data.calendar.isEmpty
          ? const Empty(
              title: 'No releases',
              message: 'No scheduled releases in the next 7 days.',
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var d = 0; d < days.length; d++) ...[
                  if (d > 0) const SizedBox(height: 8),
                  SectionLabel(isoDay(days[d].date)),
                  const SizedBox(height: 2),
                  for (final item in days[d].items)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      child: Row(
                        children: [
                          if (item.time != null && item.time!.isNotEmpty) ...[
                            Text(
                              item.time!,
                              style: LbText.number(
                                context,
                                size: 12,
                                color: context.lb.mutedForeground,
                              ),
                            ),
                            const SizedBox(width: 10),
                          ],
                          Expanded(
                            child: Text(
                              item.event,
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                          ),
                          const SizedBox(width: 8),
                          _ImportanceMark(
                            importance:
                                item.importance ?? CalendarImportance.low,
                          ),
                        ],
                      ),
                    ),
                ],
              ],
            ),
    );
  }
}

class _ImportanceMark extends StatelessWidget {
  const _ImportanceMark({required this.importance});

  final CalendarImportance importance;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final color = switch (importance) {
      CalendarImportance.high => c.loss,
      CalendarImportance.medium => c.warn,
      CalendarImportance.low => c.mutedForeground,
    };
    final name = switch (importance) {
      CalendarImportance.high => 'High',
      CalendarImportance.medium => 'Medium',
      CalendarImportance.low => 'Low',
    };
    return Semantics(
      label: '$name impact',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          if (importance == CalendarImportance.high) ...[
            const SizedBox(width: 6),
            StatusChip(
              'High impact',
              tone: StatusTone.warn,
              showIcon: false,
            ),
          ],
        ],
      ),
    );
  }
}

class _EarningsPanel extends StatelessWidget {
  const _EarningsPanel({required this.data, required this.held});

  final MarketOverview data;
  final Set<String> held;

  @override
  Widget build(BuildContext context) {
    final earnings = List<EarningsEvent>.of(data.earnings)
      ..sort((a, b) => a.date.compareTo(b.date));
    final heldCount =
        earnings.where((e) => e.held || held.contains(e.symbol)).length;
    return Panel(
      title: 'Earnings',
      reading: earnings.isEmpty
          ? null
          : heldCount > 0
              ? '$heldCount held names report in the next 30 days'
              : 'No held names report in the next 30 days',
      child: earnings.isEmpty
          ? const Empty(
              title: 'No earnings',
              message: 'No earnings in the next 30 days for held or watched names.',
            )
          : Column(
              children: [
                for (var i = 0; i < earnings.length; i++) ...[
                  if (i > 0) const Divider(height: 1),
                  _EarningsRow(
                    event: earnings[i],
                    isHeld: earnings[i].held || held.contains(earnings[i].symbol),
                  ),
                ],
              ],
            ),
    );
  }
}

class _EarningsRow extends StatelessWidget {
  const _EarningsRow({required this.event, required this.isHeld});

  final EarningsEvent event;
  final bool isHeld;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        children: [
          Flexible(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                isoDay(event.date),
                maxLines: 1,
                style: LbText.number(
                  context,
                  size: 12,
                  color: context.lb.mutedForeground,
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          TickerLink(event.symbol),
          if (event.time != null && event.time!.isNotEmpty) ...[
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                event.time!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: LbText.muted(context, size: 12),
              ),
            ),
          ] else
            const Spacer(),
          if (isHeld) ...[
            const SizedBox(width: 8),
            const StatusChip('Held', tone: StatusTone.live, showIcon: false),
          ],
        ],
      ),
    );
  }
}

extension<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
