import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'symbol_logic.dart';

const double priceChartHeight = 300;

/// Candles with volume, SMA 20/50/200, stop and entry rules and order fills.
/// Scrubbing shows date, OHLC and volume. A range change keeps the previous
/// bars on screen until the new ones arrive.
class PriceChartPanel extends ConsumerStatefulWidget {
  const PriceChartPanel({
    super.key,
    required this.symbol,
    required this.range,
    required this.onRangeChanged,
    this.detail,
  });

  final String symbol;
  final HistoryRange range;
  final ValueChanged<HistoryRange> onRangeChanged;
  final SymbolDetail? detail;

  @override
  ConsumerState<PriceChartPanel> createState() => _PriceChartPanelState();
}

class _PriceChartPanelState extends ConsumerState<PriceChartPanel> {
  List<Bar>? _last;

  static final _segments = [
    for (final e in historyRangeLabels.entries) LbSegment<HistoryRange>(e.key, e.value),
  ];

  @override
  Widget build(BuildContext context) {
    final key = '${widget.symbol}:${historyRangeWire(widget.range)}';
    final entry = ref.watch(harnessProvider.select((s) => s.history[key]));
    final fresh = entry?.data?.bars;
    if (fresh != null && fresh.isNotEmpty) _last = fresh;
    final bars = fresh ?? (entry?.state == LoadState.error ? null : _last);
    final switching = fresh == null && bars != null;
    final d = widget.detail;
    final c = context.lb;

    Widget body;
    if (entry?.state == LoadState.error && fresh == null) {
      body = SizedBox(
        height: priceChartHeight,
        child: ErrorState(
          title: 'Could not load price history',
          message: '${entry!.error}',
          onRetry: () => ref.read(harnessProvider.notifier).retryHistory(widget.symbol, widget.range),
        ),
      );
    } else if (bars == null) {
      body = const SkeletonBlock(height: priceChartHeight, radius: LbRadius.md);
    } else if (bars.isEmpty) {
      body = SizedBox(height: priceChartHeight, child: Empty(title: 'No price history for ${widget.symbol}'));
    } else {
      final stop = d?.stop;
      final entryPrice = d?.position?.averageCost;
      final lines = [
        if (stop != null) ChartReferenceLine(value: stop.price, label: 'Stop ${usd(stop.price)}', tone: ChartTone.loss),
        if (entryPrice != null) ChartReferenceLine(value: entryPrice, label: 'Entry ${usd(entryPrice)}', tone: ChartTone.primary),
      ];
      final candles = [
        for (final b in bars) CandleBar(open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume),
      ];
      final ret = periodReturn(bars);
      final label = '${widget.symbol} price, ${historyRangeLabels[widget.range]}: '
          'last close ${usd(bars.last.close)}${ret == null ? '' : ', ${pctSigned(ret)} over the range'}';
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AnimatedOpacity(
            opacity: switching ? 0.5 : 1,
            duration: LbMotion.duration(context),
            child: CandleChart(
              bars: candles,
              labels: [for (final b in bars) isoShort(b.date)],
              smaPeriods: const [20, 50, 200],
              referenceLines: lines,
              markers: fillMarkers(bars, d?.orders ?? const []),
              valueFormatter: usd,
              height: priceChartHeight,
              semanticsLabel: label,
            ),
          ),
          const SizedBox(height: 8),
          ExcludeSemantics(
            child: Wrap(
              spacing: 14,
              runSpacing: 4,
              children: [
                _Key(color: c.primary, text: 'SMA 20'),
                _Key(color: c.mutedForeground, text: 'SMA 50'),
                if (bars.length >= 200) _Key(color: c.warn, text: 'SMA 200', dashed: true),
                if (stop != null) _Key(color: c.loss, text: 'Stop', dashed: true),
                if (entryPrice != null) _Key(color: c.primary, text: 'Entry', dashed: true),
              ],
            ),
          ),
          if (switching)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('Loading ${historyRangeLabels[widget.range]}\u2026', style: LbText.caption(context)),
            ),
        ],
      );
    }

    return Panel(
      title: 'Price',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          LbSegmented<HistoryRange>(
            segments: _segments,
            selected: widget.range,
            onChanged: widget.onRangeChanged,
            semanticLabel: 'Price range',
          ),
          const SizedBox(height: LbSpace.gap),
          body,
        ],
      ),
    );
  }
}

class _Key extends StatelessWidget {
  const _Key({required this.color, required this.text, this.dashed = false});

  final Color color;
  final String text;
  final bool dashed;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 14,
          height: 2,
          child: dashed
              ? Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [for (var i = 0; i < 3; i++) SizedBox(width: 3, height: 2, child: ColoredBox(color: color))],
                )
              : ColoredBox(color: color),
        ),
        const SizedBox(width: 5),
        Text(text, style: LbText.caption(context)),
      ],
    );
  }
}
