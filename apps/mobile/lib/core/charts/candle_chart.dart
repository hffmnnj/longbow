import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'cartesian_chart.dart';
import 'chart_axes.dart';
import 'chart_format.dart';
import 'chart_math.dart';
import 'chart_palette.dart';
import 'chart_scrub.dart';

/// One OHLC bar of a [CandleChart].
@immutable
class CandleBar {
  const CandleBar({
    required this.open,
    required this.high,
    required this.low,
    required this.close,
    this.volume = 0,
  });

  final double open;
  final double high;
  final double low;
  final double close;
  final double volume;

  bool get isValid =>
      open.isFinite && high.isFinite && low.isFinite && close.isFinite;
}

/// Merges runs of [step] bars into one candle (first open, last close, highest
/// high, lowest low, summed volume). Invalid bars are skipped inside a run; a
/// run with no valid bar becomes null. Used when there are more bars than
/// pixels to draw them.
List<CandleBar?> aggregateCandles(List<CandleBar> bars, int step) {
  if (step <= 1) return [for (final b in bars) b.isValid ? b : null];
  final out = <CandleBar?>[];
  for (var s = 0; s < bars.length; s += step) {
    final run = bars
        .sublist(s, math.min(s + step, bars.length))
        .where((b) => b.isValid)
        .toList();
    if (run.isEmpty) {
      out.add(null);
      continue;
    }
    out.add(
      CandleBar(
        open: run.first.open,
        close: run.last.close,
        high: run.map((b) => b.high).reduce(math.max),
        low: run.map((b) => b.low).reduce(math.min),
        volume: run.fold(0.0, (a, b) => a + (b.volume.isFinite ? b.volume : 0)),
      ),
    );
  }
  return out;
}

class _CandleGeo {
  _CandleGeo({
    required this.size,
    required this.axes,
    required this.step,
    required this.slots,
    required this.candles,
    required this.volumes,
    required this.smas,
    required this.refs,
    required this.markers,
    required this.snap,
  });

  final Size size;
  final AxisLayout axes;

  /// Original bars per drawn slot.
  final int step;
  final int slots;
  final List<
    (
      double x,
      double w,
      double yHigh,
      double yLow,
      double yOpen,
      double yClose,
      bool up,
    )?
  >
  candles;
  final List<(double x, double w, double top, double bottom, bool up)?> volumes;
  final List<(Polyline, Color, bool dashed)> smas;
  final List<(double y, Color color)> refs;
  final List<(double x, double y, ChartMarkerKind kind)> markers;
  final List<int> snap;

  Rect get plot => axes.plot;
  double get slotW => slots == 0 ? plot.width : plot.width / slots;
  double xOfSlot(int s) => plot.left + (s + 0.5) * slotW;
  double xAt(int i) => xOfSlot((i ~/ step).clamp(0, math.max(slots - 1, 0)));

  int? indexAt(double dx) {
    if (slots == 0 || snap.isEmpty) return null;
    final s = ((dx - plot.left) / slotW).floor().clamp(0, slots - 1);
    return nearestIndex(snap, math.min(s * step + step ~/ 2, snap.last));
  }
}

/// Candlesticks with a volume strip, moving averages, price rules and
/// entry/exit markers: the symbol detail price chart.
///
/// Bars are drawn left to right in order. [smaPeriods] draws simple moving
/// averages of the close (the first in primary, the second muted, any third
/// dashed warn); an average only appears once enough bars exist. With more bars
/// than pixels, bars are merged into candles of equal span. Scrub (horizontal
/// drag) reports the original bar index through [onScrub] and shows date, OHLC
/// and volume in a bubble.
class CandleChart extends StatefulWidget {
  const CandleChart({
    super.key,
    required this.bars,
    this.labels,
    this.smaPeriods = const [20, 50],
    this.showVolume = true,
    this.referenceLines = const [],
    this.markers = const [],
    this.valueFormatter,
    this.onScrub,
    this.showReadout = true,
    this.semanticsLabel,
    this.height = 280,
    this.scrubMode = ChartScrubMode.drag,
    this.enableHaptics = true,
    this.maxXLabels = 4,
    this.animate = true,
    this.hapticsOverride,
  });

  final List<CandleBar> bars;

  /// One x label per bar (dates).
  final List<String>? labels;

  /// Moving average periods drawn over the candles.
  final List<int> smaPeriods;
  final bool showVolume;

  /// Price rules such as stop and entry.
  final List<ChartReferenceLine> referenceLines;

  /// Entry (buy) and exit (sell) markers; [ChartMarker.index] is a bar index.
  final List<ChartMarker> markers;
  final String Function(double)? valueFormatter;
  final ValueChanged<int?>? onScrub;
  final bool showReadout;

  /// Spoken summary. Defaults to first and last close and the change.
  final String? semanticsLabel;
  final double height;
  final ChartScrubMode scrubMode;
  final bool enableHaptics;
  final int maxXLabels;
  final bool animate;
  final ScrubHaptics? hapticsOverride;

  @override
  State<CandleChart> createState() => _CandleChartState();
}

class _CandleChartState extends State<CandleChart>
    with SingleTickerProviderStateMixin {
  late final AnimationController _reveal = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 400),
  );
  final ValueNotifier<int?> _scrub = ValueNotifier<int?>(null);
  _CandleGeo? _geo;
  Object? _key;
  int _version = 0;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context) || !widget.animate) {
      _reveal.value = 1;
    } else if (!_started) {
      _reveal.forward(from: 0);
    }
    _started = true;
  }

  @override
  void didUpdateWidget(CandleChart old) {
    super.didUpdateWidget(old);
    var same =
        old.bars.length == widget.bars.length &&
        old.showVolume == widget.showVolume &&
        old.smaPeriods.length == widget.smaPeriods.length &&
        old.referenceLines.length == widget.referenceLines.length &&
        old.markers.length == widget.markers.length;
    if (same && !identical(old.bars, widget.bars)) {
      for (var i = 0; i < old.bars.length && same; i++) {
        final a = old.bars[i];
        final b = widget.bars[i];
        same =
            a.open == b.open &&
            a.high == b.high &&
            a.low == b.low &&
            a.close == b.close &&
            a.volume == b.volume;
      }
    }
    if (same) {
      for (var i = 0; i < old.referenceLines.length && same; i++) {
        same = old.referenceLines[i].value == widget.referenceLines[i].value;
      }
      for (var i = 0; i < old.markers.length && same; i++) {
        same =
            old.markers[i].index == widget.markers[i].index &&
            old.markers[i].kind == widget.markers[i].kind;
      }
      for (var i = 0; i < old.smaPeriods.length && same; i++) {
        same = old.smaPeriods[i] == widget.smaPeriods[i];
      }
    }
    if (!same) {
      _version++;
      _scrub.value = null;
    }
  }

  @override
  void dispose() {
    _reveal.dispose();
    _scrub.dispose();
    _geo?.axes.dispose();
    super.dispose();
  }

  _CandleGeo _build(Size size, ChartPalette palette, TextScaler scaler) {
    final w = widget;
    final n = w.bars.length;
    final valid = w.bars.where((b) => b.isValid).toList();
    final hasData = valid.isNotEmpty;
    final closes = [for (final b in w.bars) b.isValid ? b.close : double.nan];
    final smaValues = [
      for (final p in w.smaPeriods) simpleMovingAverage(closes, p),
    ];
    final prices = <double>[
      for (final b in valid) ...[b.high, b.low],
      for (final r in w.referenceLines) r.value,
    ];
    final domain = paddedDomain(
      prices,
      padBottom: w.showVolume ? 0.24 : 0.06,
      padTop: 0.06,
    );
    final axes = AxisLayout.compute(
      size: size,
      domainMin: domain.min,
      domainMax: domain.max,
      palette: palette,
      textScaler: scaler,
      format: w.valueFormatter,
      xLabelTexts: w.labels,
      xCount: n,
      xAt: (plot, i) => plot.left + (i + 0.5) * plot.width / math.max(n, 1),
      maxXLabels: w.maxXLabels,
      showY: hasData,
      showX: hasData,
    );
    final plot = axes.plot;
    final maxSlots = math.max(8, (plot.width / 2).floor());
    final step = n <= maxSlots ? 1 : (n / maxSlots).ceil();
    final merged = aggregateCandles(w.bars, step);
    final slots = hasData ? merged.length : 0;
    final slotW = slots == 0 ? plot.width : plot.width / slots;
    final bodyW = math.max(1.0, slotW * 0.62);
    final y = axes.yScale;
    final maxVol = merged.fold<double>(
      0,
      (m, b) => b == null ? m : math.max(m, b.volume.isFinite ? b.volume : 0),
    );
    final volTop = plot.top + plot.height * 0.82;
    final candles = <(double, double, double, double, double, double, bool)?>[];
    final volumes = <(double, double, double, double, bool)?>[];
    for (var s = 0; s < merged.length; s++) {
      final b = merged[s];
      if (b == null) {
        candles.add(null);
        volumes.add(null);
        continue;
      }
      final cx = plot.left + (s + 0.5) * slotW;
      final up = b.close >= b.open;
      candles.add((
        cx,
        bodyW,
        y.map(b.high),
        y.map(b.low),
        y.map(b.open),
        y.map(b.close),
        up,
      ));
      volumes.add(
        w.showVolume && maxVol > 0
            ? (
                cx,
                bodyW,
                plot.bottom -
                    (b.volume.isFinite ? b.volume : 0) /
                        maxVol *
                        (plot.bottom - volTop),
                plot.bottom,
                up,
              )
            : null,
      );
    }
    final maxPoints = math.max(16, (plot.width * 1.5).round());
    final smas = <(Polyline, Color, bool)>[];
    for (var k = 0; k < smaValues.length; k++) {
      final color = k == 0
          ? palette.tone(ChartTone.primary)
          : k == 1
          ? palette.tone(ChartTone.muted)
          : palette.tone(ChartTone.warn);
      smas.add((
        projectSeries(
          smaValues[k],
          n: n,
          left: plot.left + slotW / 2 * (step == 1 ? 1 : 0),
          right: plot.right - slotW / 2 * (step == 1 ? 1 : 0),
          yScale: y,
          maxPoints: maxPoints,
        ),
        color,
        k >= 2,
      ));
    }
    final markers = <(double, double, ChartMarkerKind)>[];
    for (final m in w.markers) {
      if (m.index < 0 || m.index >= n || !w.bars[m.index].isValid) continue;
      final b = w.bars[m.index];
      final s = (m.index ~/ step).clamp(0, math.max(slots - 1, 0));
      final x = plot.left + (s + 0.5) * slotW;
      // Buys sit under the low (triangle points up), sells over the high.
      markers.add((
        x,
        y.map(m.kind == ChartMarkerKind.sell ? b.high : b.low),
        m.kind,
      ));
    }
    return _CandleGeo(
      size: size,
      axes: axes,
      step: step,
      slots: slots,
      candles: candles,
      volumes: volumes,
      smas: smas,
      refs: [
        for (final r in w.referenceLines)
          if (r.value.isFinite) (y.map(r.value), palette.tone(r.tone)),
      ],
      markers: markers,
      snap: [
        for (var i = 0; i < n; i++)
          if (w.bars[i].isValid) i,
      ],
    );
  }

  String _semantics() {
    final w = widget;
    if (w.semanticsLabel != null) return w.semanticsLabel!;
    return summarizeSeries(
      [for (final b in w.bars) b.isValid ? b.close : double.nan],
      name: 'Price chart',
      format: w.valueFormatter,
    );
  }

  Widget _readout(BuildContext context, int i) {
    final c = ChartPalette.of(context).colors;
    final fmt = widget.valueFormatter ?? formatChartNumber;
    final b = widget.bars[i];
    final labels = widget.labels;
    Widget kv(String k, String v) => Text.rich(
      TextSpan(
        children: [
          TextSpan(text: '$k ', style: chartTextStyle(c.mutedForeground)),
          TextSpan(text: v, style: chartTextStyle(c.foreground, size: 11.5)),
        ],
      ),
    );
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (labels != null && i < labels.length)
          Text(labels[i], style: chartTextStyle(c.mutedForeground)),
        Wrap(
          spacing: 8,
          children: [
            kv('O', fmt(b.open)),
            kv('H', fmt(b.high)),
            kv('L', fmt(b.low)),
            kv('C', fmt(b.close)),
          ],
        ),
        if (b.volume > 0) kv('Vol', formatChartNumber(b.volume)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = ChartPalette.of(context);
    final scaler = MediaQuery.textScalerOf(context);
    final dpr = MediaQuery.devicePixelRatioOf(context);
    return Semantics(
      container: true,
      image: true,
      label: _semantics(),
      child: ExcludeSemantics(
        child: RepaintBoundary(
          child: SizedBox(
            height: widget.height,
            child: LayoutBuilder(
              builder: (context, box) {
                final w = box.maxWidth.isFinite ? box.maxWidth : 0.0;
                final h = box.maxHeight.isFinite
                    ? box.maxHeight
                    : widget.height;
                if (w <= 0 || h <= 0) return const SizedBox.shrink();
                final size = Size(w, h);
                final key = (size, dpr, scaler, palette, _version);
                if (_geo == null || _key != key) {
                  final old = _geo;
                  _geo = _build(size, palette, scaler);
                  _key = key;
                  old?.axes.dispose();
                }
                final geo = _geo!;
                Widget stack = SizedBox(
                  width: w,
                  height: h,
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: RepaintBoundary(
                          child: CustomPaint(
                            painter: _CandlePainter(
                              geo: geo,
                              palette: palette,
                              reveal: _reveal,
                            ),
                          ),
                        ),
                      ),
                      Positioned.fill(
                        child: RepaintBoundary(
                          child: CustomPaint(
                            painter: _CandleScrubPainter(
                              geo: geo,
                              palette: palette,
                              scrub: _scrub,
                              bars: widget.bars,
                            ),
                          ),
                        ),
                      ),
                      if (widget.showReadout && geo.slots > 0)
                        Positioned.fill(
                          child: ScrubBubble(
                            scrub: _scrub,
                            xAt: geo.xAt,
                            builder: _readout,
                          ),
                        ),
                    ],
                  ),
                );
                if (geo.slots > 0) {
                  stack = ScrubRegion(
                    mode: widget.scrubMode,
                    haptics: widget.enableHaptics,
                    hapticsOverride: widget.hapticsOverride,
                    indexAt: (dx) => _geo?.indexAt(dx),
                    onChanged: (i) {
                      _scrub.value = i;
                      widget.onScrub?.call(i);
                    },
                    child: stack,
                  );
                }
                return stack;
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _CandlePainter extends CustomPainter {
  _CandlePainter({
    required this.geo,
    required this.palette,
    required this.reveal,
  }) : super(repaint: reveal);

  final _CandleGeo geo;
  final ChartPalette palette;
  final Animation<double> reveal;

  @override
  void paint(Canvas canvas, Size size) {
    final plot = geo.plot;
    geo.axes.paintGrid(canvas);
    if (geo.slots == 0) {
      final p = Paint()
        ..color = palette.axis
        ..strokeWidth = 1;
      for (var x = plot.left; x < plot.right; x += 8) {
        canvas.drawLine(
          Offset(x, plot.center.dy),
          Offset(math.min(x + 4, plot.right), plot.center.dy),
          p,
        );
      }
      return;
    }
    final r = Curves.easeOutCubic.transform(reveal.value.clamp(0.0, 1.0));
    final up = palette.candleUp;
    final down = palette.candleDown;
    for (final v in geo.volumes) {
      if (v == null) continue;
      canvas.drawRect(
        Rect.fromLTRB(v.$1 - v.$2 / 2, v.$3, v.$1 + v.$2 / 2, v.$4),
        Paint()..color = (v.$5 ? up : down).withValues(alpha: 0.32 * r),
      );
    }
    for (final rule in geo.refs) {
      final p = Paint()
        ..color = rule.$2.withValues(alpha: r)
        ..strokeWidth = 1.25;
      for (var x = plot.left; x < plot.right; x += 7) {
        canvas.drawLine(
          Offset(x, rule.$1),
          Offset(math.min(x + 4, plot.right), rule.$1),
          p,
        );
      }
    }
    for (final c in geo.candles) {
      if (c == null) continue;
      final color = (c.$7 ? up : down).withValues(alpha: r);
      final paint = Paint()..color = color;
      final x = c.$1;
      canvas.drawLine(
        Offset(x, c.$3),
        Offset(x, c.$4),
        Paint()
          ..color = color
          ..strokeWidth = 1,
      );
      final top = math.min(c.$5, c.$6);
      final bottom = math.max(c.$5, c.$6);
      canvas.drawRect(
        Rect.fromLTRB(
          x - c.$2 / 2,
          top,
          x + c.$2 / 2,
          math.max(bottom, top + 1),
        ),
        paint,
      );
    }
    for (final s in geo.smas) {
      final poly = s.$1;
      if (poly.length < 2) continue;
      final path = Path()..moveTo(poly.xs[0], poly.ys[0]);
      for (var i = 1; i < poly.length; i++) {
        path.lineTo(poly.xs[i], poly.ys[i]);
      }
      final p = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.25
        ..color = s.$2.withValues(alpha: r);
      canvas.drawPath(s.$3 ? dashPath(path, 5, 4) : path, p);
    }
    for (final m in geo.markers) {
      final isBuy = m.$3 == ChartMarkerKind.buy;
      final color = switch (m.$3) {
        ChartMarkerKind.buy => palette.markerBuy,
        ChartMarkerKind.sell => palette.markerSell,
        ChartMarkerKind.neutral => palette.markerNeutral,
      }.withValues(alpha: r);
      final dir = isBuy ? 1.0 : -1.0;
      final tip = m.$2 + dir * 5;
      canvas.drawPath(
        Path()
          ..moveTo(m.$1, tip)
          ..lineTo(m.$1 - 4.5, tip + dir * 8)
          ..lineTo(m.$1 + 4.5, tip + dir * 8)
          ..close(),
        Paint()..color = color,
      );
    }
    geo.axes.paintLabels(canvas);
  }

  @override
  bool shouldRepaint(_CandlePainter old) =>
      old.geo != geo || old.palette != palette;
}

class _CandleScrubPainter extends CustomPainter {
  _CandleScrubPainter({
    required this.geo,
    required this.palette,
    required this.scrub,
    required this.bars,
  }) : super(repaint: scrub);

  final _CandleGeo geo;
  final ChartPalette palette;
  final ValueNotifier<int?> scrub;
  final List<CandleBar> bars;

  @override
  void paint(Canvas canvas, Size size) {
    final i = scrub.value;
    if (i == null || geo.slots == 0 || i >= bars.length) return;
    final x = geo.xAt(i);
    final plot = geo.plot;
    canvas.drawLine(
      Offset(x, plot.top),
      Offset(x, plot.bottom),
      Paint()
        ..color = palette.crosshair
        ..strokeWidth = 1,
    );
    final y = geo.axes.yScale.map(bars[i].close);
    canvas.drawCircle(Offset(x, y), 5, Paint()..color = palette.dotRing);
    canvas.drawCircle(
      Offset(x, y),
      3,
      Paint()..color = palette.colors.foreground,
    );
  }

  @override
  bool shouldRepaint(_CandleScrubPainter old) =>
      old.geo != geo || old.palette != palette || old.bars != bars;
}
