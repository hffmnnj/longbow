import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'chart_axes.dart';
import 'chart_format.dart';
import 'chart_math.dart';
import 'chart_palette.dart';
import 'chart_scrub.dart';
import 'dither.dart';

/// One series of a [ColumnChart].
@immutable
class ColumnSeries {
  const ColumnSeries({required this.values, this.name = '', this.tone});

  /// One value per category. NaN and infinite values draw no bar.
  final List<double> values;

  /// Legend and readout name.
  final String name;

  /// Null cycles through the palette.
  final ChartTone? tone;
}

class _Bar {
  _Bar(this.rect, this.color, this.up);
  final Rect rect;
  final Color color;
  final bool up;
}

class _Masks {
  _Masks(this.byColor, this.caps);
  final Map<Color, DitherMask> byColor;
  final List<(Rect, Color)> caps;
}

class _ColumnGeometry {
  _ColumnGeometry({
    required this.size,
    required this.axes,
    required this.n,
    required this.y0,
    required this.bars,
    required this.cell,
  });

  final Size size;
  final AxisLayout axes;
  final int n;
  final double y0;
  final List<_Bar> bars;
  final double cell;

  Rect get plot => axes.plot;
  double get slot => n == 0 ? plot.width : plot.width / n;
  double xAt(int i) => plot.left + (i + 0.5) * slot;

  int? indexAt(double dx) {
    if (n == 0) return null;
    return ((dx - plot.left) / slot).floor().clamp(0, n - 1);
  }

  _Masks masks(double reveal) {
    final builders = <Color, DitherMaskBuilder>{};
    final caps = <(Rect, Color)>[];
    for (final b in bars) {
      final r = reveal >= 1
          ? b.rect
          : Rect.fromLTRB(
              b.rect.left,
              y0 + (b.rect.top - y0) * reveal,
              b.rect.right,
              y0 + (b.rect.bottom - y0) * reveal,
            );
      if (r.height <= 0) continue;
      (builders[b.color] ??= DitherMaskBuilder(
        cell,
      )).addVerticalBar(r, tipAtTop: b.up);
      final capH = math.min(1.5, r.height);
      caps.add((
        Rect.fromLTWH(r.left, b.up ? r.top : r.bottom - capH, r.width, capH),
        b.color,
      ));
    }
    return _Masks({
      for (final e in builders.entries) e.key: e.value.build(),
    }, caps);
  }

  late final _Masks settled = masks(1);

  static _ColumnGeometry build({
    required Size size,
    required List<String> categories,
    required List<ColumnSeries> series,
    required bool stacked,
    required bool colorBySign,
    required ChartPalette palette,
    required TextScaler textScaler,
    required double devicePixelRatio,
    required String Function(double)? format,
    required int maxXLabels,
  }) {
    var n = categories.length;
    for (final s in series) {
      n = math.max(n, s.values.length);
    }
    double v(ColumnSeries s, int i) =>
        i < s.values.length && s.values[i].isFinite ? s.values[i] : 0;
    var lo = 0.0;
    var hi = 0.0;
    var any = false;
    for (var i = 0; i < n; i++) {
      var pos = 0.0;
      var neg = 0.0;
      for (final s in series) {
        final x = v(s, i);
        if (i < s.values.length && s.values[i].isFinite) any = true;
        if (stacked) {
          if (x >= 0) {
            pos += x;
          } else {
            neg += x;
          }
        } else {
          lo = math.min(lo, x);
          hi = math.max(hi, x);
        }
      }
      if (stacked) {
        lo = math.min(lo, neg);
        hi = math.max(hi, pos);
      }
    }
    final domain = !any
        ? (min: 0.0, max: 1.0)
        : paddedDomain([lo, hi], includeZero: true, padTop: 0.06);
    final axes = AxisLayout.compute(
      size: size,
      domainMin: domain.min,
      domainMax: domain.max,
      palette: palette,
      textScaler: textScaler,
      format: format,
      xLabelTexts: categories,
      xCount: n,
      xAt: (plot, i) => plot.left + (i + 0.5) * plot.width / math.max(n, 1),
      maxXLabels: maxXLabels,
      showY: any,
      showX: any,
    );
    final plot = axes.plot;
    final y0 = axes.yScale.map(0);
    final slot = n == 0 ? plot.width : plot.width / n;
    final inner = math.max(1.0, slot * 0.72);
    final k = stacked ? 1 : math.max(series.length, 1);
    final barW = math.max(1.0, inner / k);
    final bars = <_Bar>[];
    for (var i = 0; i < n; i++) {
      final left = plot.left + i * slot + (slot - barW * k) / 2;
      var posTop = 0.0;
      var negBot = 0.0;
      for (var s = 0; s < series.length; s++) {
        final spec = series[s];
        if (i >= spec.values.length || !spec.values[i].isFinite) continue;
        final x = spec.values[i];
        if (x == 0) continue;
        final color = palette.tone(
          colorBySign && series.length == 1
              ? (x > 0 ? ChartTone.gain : ChartTone.loss)
              : spec.tone ?? ChartPalette.cycle[s % ChartPalette.cycle.length],
        );
        double from;
        double to;
        if (stacked) {
          if (x >= 0) {
            from = posTop;
            posTop += x;
            to = posTop;
          } else {
            from = negBot;
            negBot += x;
            to = negBot;
          }
        } else {
          from = 0;
          to = x;
        }
        final yA = axes.yScale.map(from);
        final yB = axes.yScale.map(to);
        final bx = stacked ? left : left + s * barW;
        bars.add(
          _Bar(
            Rect.fromLTRB(bx, math.min(yA, yB), bx + barW, math.max(yA, yB)),
            color,
            x > 0,
          ),
        );
      }
    }
    return _ColumnGeometry(
      size: size,
      axes: axes,
      n: any ? n : 0,
      y0: y0,
      bars: bars,
      cell: ditherCellSize(devicePixelRatio),
    );
  }
}

class _ColumnPainter extends CustomPainter {
  _ColumnPainter({
    required this.geo,
    required this.palette,
    required this.reveal,
  }) : super(repaint: reveal);

  final _ColumnGeometry geo;
  final ChartPalette palette;
  final Animation<double> reveal;

  @override
  void paint(Canvas canvas, Size size) {
    final plot = geo.plot;
    geo.axes.paintGrid(canvas);
    if (geo.n == 0) {
      final p = Paint()
        ..color = palette.axis
        ..strokeWidth = 1;
      for (var x = plot.left; x < plot.right; x += 8) {
        canvas.drawLine(
          Offset(x, plot.bottom - 1),
          Offset(math.min(x + 4, plot.right), plot.bottom - 1),
          p,
        );
      }
      return;
    }
    final r = Curves.easeOutCubic.transform(reveal.value.clamp(0.0, 1.0));
    final m = r >= 1 ? geo.settled : geo.masks(r);
    for (final e in m.byColor.entries) {
      paintDitherMask(canvas, e.value, e.key);
    }
    for (final (rect, color) in m.caps) {
      canvas.drawRect(rect, Paint()..color = color);
    }
    canvas.drawLine(
      Offset(plot.left, geo.y0.roundToDouble() + 0.5),
      Offset(plot.right, geo.y0.roundToDouble() + 0.5),
      Paint()
        ..color = palette.axis
        ..strokeWidth = 1,
    );
    geo.axes.paintLabels(canvas);
  }

  @override
  bool shouldRepaint(_ColumnPainter old) =>
      old.geo != geo || old.palette != palette;
}

class _BandPainter extends CustomPainter {
  _BandPainter({required this.geo, required this.palette, required this.scrub})
    : super(repaint: scrub);

  final _ColumnGeometry geo;
  final ChartPalette palette;
  final ValueNotifier<int?> scrub;

  @override
  void paint(Canvas canvas, Size size) {
    final i = scrub.value;
    if (i == null || geo.n == 0) return;
    final plot = geo.plot;
    canvas.drawRect(
      Rect.fromLTRB(
        plot.left + i * geo.slot,
        plot.top,
        plot.left + (i + 1) * geo.slot,
        plot.bottom,
      ),
      Paint()..color = palette.colors.foreground.withValues(alpha: 0.07),
    );
  }

  @override
  bool shouldRepaint(_BandPainter old) =>
      old.geo != geo || old.palette != palette;
}

/// Vertical dithered columns on a zero axis: P&L per trade, calibration
/// buckets (predicted next to realized), weekly returns. Grouped by default,
/// [stacked] piles series in one column. Negative values hang below the zero
/// line. With [colorBySign] a single series colors gain above zero and loss
/// below.
///
/// Scrub: horizontal drag highlights the category under the finger and reports
/// its index through [onScrub]; a readout bubble lists each series' value.
/// Columns grow from the zero line on first draw. Up to a few hundred
/// categories stay legible; screens with thousands should aggregate first.
class ColumnChart extends StatefulWidget {
  const ColumnChart({
    super.key,
    required this.categories,
    required this.series,
    this.stacked = false,
    this.colorBySign = false,
    this.valueFormatter,
    this.onScrub,
    this.showReadout = true,
    this.semanticsLabel,
    this.height = 180,
    this.scrubMode = ChartScrubMode.drag,
    this.enableHaptics = true,
    this.maxXLabels = 4,
    this.animate = true,
    this.hapticsOverride,
  });

  /// One name per column. At most [maxXLabels] are printed.
  final List<String> categories;
  final List<ColumnSeries> series;

  /// Pile series in one column instead of placing them side by side.
  final bool stacked;

  /// Single series only: gain above zero, loss below.
  final bool colorBySign;
  final String Function(double)? valueFormatter;

  /// Scrubbed column index, null on release.
  final ValueChanged<int?>? onScrub;
  final bool showReadout;

  /// Spoken summary. Defaults to a summary of the first series.
  final String? semanticsLabel;
  final double height;
  final ChartScrubMode scrubMode;
  final bool enableHaptics;
  final int maxXLabels;
  final bool animate;

  /// Replaces the real haptics (tests).
  final ScrubHaptics? hapticsOverride;

  @override
  State<ColumnChart> createState() => _ColumnChartState();
}

class _ColumnChartState extends State<ColumnChart>
    with SingleTickerProviderStateMixin {
  late final AnimationController _reveal = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 400),
  );
  final ValueNotifier<int?> _scrub = ValueNotifier<int?>(null);
  _ColumnGeometry? _geo;
  Object? _key;
  int _version = 0;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduce = MediaQuery.disableAnimationsOf(context) || !widget.animate;
    if (reduce) {
      _reveal.value = 1;
    } else if (!_started) {
      _reveal.forward(from: 0);
    }
    _started = true;
  }

  @override
  void didUpdateWidget(ColumnChart old) {
    super.didUpdateWidget(old);
    bool sameSeries() {
      if (old.series.length != widget.series.length) return false;
      for (var i = 0; i < old.series.length; i++) {
        final a = old.series[i];
        final b = widget.series[i];
        if (a.name != b.name || a.tone != b.tone) return false;
        if (a.values.length != b.values.length) return false;
        for (var k = 0; k < a.values.length; k++) {
          if (a.values[k] != b.values[k] &&
              !(a.values[k].isNaN && b.values[k].isNaN)) {
            return false;
          }
        }
      }
      return true;
    }

    final cats =
        old.categories.length == widget.categories.length &&
        [
          for (var i = 0; i < old.categories.length; i++)
            old.categories[i] == widget.categories[i],
        ].every((e) => e);
    if (!(cats &&
        sameSeries() &&
        old.stacked == widget.stacked &&
        old.colorBySign == widget.colorBySign &&
        old.maxXLabels == widget.maxXLabels)) {
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

  Widget _readout(BuildContext context, int i) {
    final lb = ChartPalette.of(context).colors;
    final fmt = widget.valueFormatter ?? formatChartNumber;
    final palette = ChartPalette.of(context);
    final multi = widget.series.length > 1;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (i < widget.categories.length)
          Text(widget.categories[i], style: chartTextStyle(lb.mutedForeground)),
        for (var s = 0; s < widget.series.length; s++)
          if (i < widget.series[s].values.length &&
              widget.series[s].values[i].isFinite)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (multi) ...[
                  Container(
                    width: 8,
                    height: 8,
                    color: palette.tone(
                      widget.series[s].tone ??
                          ChartPalette.cycle[s % ChartPalette.cycle.length],
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${widget.series[s].name} ',
                    style: chartTextStyle(lb.mutedForeground),
                  ),
                ],
                Text(
                  fmt(widget.series[s].values[i]),
                  style: chartTextStyle(
                    lb.foreground,
                    size: 12.5,
                    weight: FontWeight.w600,
                  ),
                ),
              ],
            ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = ChartPalette.of(context);
    final scaler = MediaQuery.textScalerOf(context);
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final first = widget.series.isEmpty
        ? const <double>[]
        : widget.series.first.values;
    return Semantics(
      container: true,
      image: true,
      label:
          widget.semanticsLabel ??
          summarizeSeries(
            first,
            name: 'Column chart',
            format: widget.valueFormatter,
          ),
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
                  _geo = _ColumnGeometry.build(
                    size: size,
                    categories: widget.categories,
                    series: widget.series,
                    stacked: widget.stacked,
                    colorBySign: widget.colorBySign,
                    palette: palette,
                    textScaler: scaler,
                    devicePixelRatio: dpr,
                    format: widget.valueFormatter,
                    maxXLabels: widget.maxXLabels,
                  );
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
                            painter: _ColumnPainter(
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
                            painter: _BandPainter(
                              geo: geo,
                              palette: palette,
                              scrub: _scrub,
                            ),
                          ),
                        ),
                      ),
                      if (widget.showReadout && geo.n > 0)
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
                if (geo.n > 0) {
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
