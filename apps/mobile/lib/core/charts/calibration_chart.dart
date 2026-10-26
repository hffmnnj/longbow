import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'chart_axes.dart';
import 'chart_format.dart';
import 'chart_palette.dart';
import 'chart_scrub.dart';

/// One bucket of a [CalibrationChart].
@immutable
class CalibrationPoint {
  const CalibrationPoint({
    required this.predicted,
    required this.realized,
    this.count = 1,
    this.label = '',
  });

  /// What was claimed, in the chart's units (percent by default).
  final double predicted;

  /// What happened, same units.
  final double realized;

  /// How many trades fell in the bucket; sizes the dot.
  final int count;

  /// Readout title, such as "60 to 70%".
  final String label;
}

/// Predicted against realized win rate. A dashed diagonal marks perfect
/// calibration; each bucket is a dot sized by its trade count. Dots well below
/// the diagonal (overconfident by more than [tolerance]) turn loss, the rest
/// stay primary.
///
/// Both axes run 0 to [max] (default 100, percent). Buckets with non-finite
/// values are skipped. Fills the width; [height] default 200. Dragging or
/// tapping selects the bucket nearest in x and reports its index through
/// [onSelect] (null on release); a readout bubble shows predicted, realized
/// and count. Dots grow in on first draw unless animations are disabled.
class CalibrationChart extends StatefulWidget {
  const CalibrationChart({
    super.key,
    required this.points,
    this.max = 100,
    this.unit = '%',
    this.tolerance = 10,
    this.onSelect,
    this.showReadout = true,
    this.semanticsLabel,
    this.height = 200,
    this.enableHaptics = true,
    this.animate = true,
  });

  final List<CalibrationPoint> points;

  /// Top of both axes.
  final double max;

  /// Suffix for axis ticks and readout values.
  final String unit;

  /// How far below the diagonal a dot may sit before it turns loss.
  final double tolerance;

  /// Selected bucket index (into [points]), null on release.
  final ValueChanged<int?>? onSelect;
  final bool showReadout;

  /// Spoken summary. Defaults to a count and the worst overconfidence.
  final String? semanticsLabel;
  final double height;
  final bool enableHaptics;
  final bool animate;

  @override
  State<CalibrationChart> createState() => _CalibrationChartState();
}

class _Dot {
  _Dot(this.index, this.center, this.radius, this.over);
  final int index;
  final Offset center;
  final double radius;
  final bool over;
}

class _CalGeo {
  _CalGeo(this.size, this.axes, this.dots);
  final Size size;
  final AxisLayout axes;
  final List<_Dot> dots;

  Rect get plot => axes.plot;

  int? nearestByX(double dx) {
    if (dots.isEmpty) return null;
    var best = dots.first;
    for (final d in dots) {
      if ((d.center.dx - dx).abs() < (best.center.dx - dx).abs()) best = d;
    }
    return best.index;
  }

  Offset? centerOf(int index) {
    for (final d in dots) {
      if (d.index == index) return d.center;
    }
    return null;
  }
}

class _CalibrationChartState extends State<CalibrationChart>
    with SingleTickerProviderStateMixin {
  late final AnimationController _reveal = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 400),
  );
  final ValueNotifier<int?> _sel = ValueNotifier<int?>(null);
  _CalGeo? _geo;
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
  void dispose() {
    _reveal.dispose();
    _sel.dispose();
    _geo?.axes.dispose();
    super.dispose();
  }

  String _fmt(double v) =>
      '${formatChartNumber(v, fractionDigits: 0)}${widget.unit}';

  String _semantics() {
    if (widget.semanticsLabel != null) return widget.semanticsLabel!;
    final pts = widget.points
        .where((p) => p.predicted.isFinite && p.realized.isFinite)
        .toList();
    if (pts.isEmpty) return 'Calibration chart, no data';
    final worst = pts
        .map((p) => p.realized - p.predicted)
        .reduce((a, b) => a < b ? a : b);
    return 'Calibration chart, ${pts.length} buckets, predicted against '
        'realized${worst < 0 ? ', worst shortfall ${_fmt(worst.abs())}' : ', none below prediction'}';
  }

  _CalGeo _build(Size size, ChartPalette palette, TextScaler scaler) {
    final axes = AxisLayout.compute(
      size: size,
      domainMin: 0,
      domainMax: widget.max,
      palette: palette,
      textScaler: scaler,
      format: _fmt,
      xLabelTexts: [_fmt(0), _fmt(widget.max / 2), _fmt(widget.max)],
      xCount: 3,
      maxXLabels: 3,
    );
    final plot = axes.plot;
    final maxCount = widget.points
        .where((p) => p.predicted.isFinite && p.realized.isFinite)
        .fold<int>(1, (m, p) => math.max(m, p.count));
    final dots = <_Dot>[];
    for (var i = 0; i < widget.points.length; i++) {
      final p = widget.points[i];
      if (!p.predicted.isFinite || !p.realized.isFinite) continue;
      final x =
          plot.left + (p.predicted / widget.max).clamp(0.0, 1.0) * plot.width;
      final y = axes.yScale.map(p.realized.clamp(0.0, widget.max));
      final r = 4 + 6 * math.sqrt(math.max(p.count, 1) / maxCount);
      dots.add(
        _Dot(i, Offset(x, y), r, p.realized < p.predicted - widget.tolerance),
      );
    }
    return _CalGeo(size, axes, dots);
  }

  @override
  Widget build(BuildContext context) {
    final palette = ChartPalette.of(context);
    final scaler = MediaQuery.textScalerOf(context);
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
                final old = _geo;
                final geo = _build(Size(w, h), palette, scaler);
                _geo = geo;
                old?.axes.dispose();
                Widget body = SizedBox(
                  width: w,
                  height: h,
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: RepaintBoundary(
                          child: CustomPaint(
                            painter: _CalPainter(
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
                            painter: _SelPainter(
                              geo: geo,
                              palette: palette,
                              sel: _sel,
                            ),
                          ),
                        ),
                      ),
                      if (widget.showReadout && geo.dots.isNotEmpty)
                        Positioned.fill(
                          child: ScrubBubble(
                            scrub: _sel,
                            xAt: (i) => geo.centerOf(i)?.dx ?? 0,
                            builder: (context, i) {
                              final c = palette.colors;
                              final p = widget.points[i];
                              return Column(
                                mainAxisSize: MainAxisSize.min,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  if (p.label.isNotEmpty)
                                    Text(
                                      p.label,
                                      style: chartTextStyle(c.mutedForeground),
                                    ),
                                  Text(
                                    'Predicted ${_fmt(p.predicted)}  Realized ${_fmt(p.realized)}',
                                    style: chartTextStyle(
                                      c.foreground,
                                      size: 12,
                                      weight: FontWeight.w600,
                                    ),
                                  ),
                                  Text(
                                    '${p.count} ${p.count == 1 ? 'trade' : 'trades'}',
                                    style: chartTextStyle(c.mutedForeground),
                                  ),
                                ],
                              );
                            },
                          ),
                        ),
                    ],
                  ),
                );
                if (geo.dots.isNotEmpty) {
                  body = ScrubRegion(
                    haptics: widget.enableHaptics,
                    indexAt: (dx) => _geo?.nearestByX(dx),
                    onChanged: (i) {
                      _sel.value = i;
                      widget.onSelect?.call(i);
                    },
                    child: body,
                  );
                }
                return body;
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _CalPainter extends CustomPainter {
  _CalPainter({required this.geo, required this.palette, required this.reveal})
    : super(repaint: reveal);

  final _CalGeo geo;
  final ChartPalette palette;
  final Animation<double> reveal;

  @override
  void paint(Canvas canvas, Size size) {
    final plot = geo.plot;
    geo.axes.paintGrid(canvas);
    final diag = Paint()
      ..color = palette.axis
      ..strokeWidth = 1.25
      ..style = PaintingStyle.stroke;
    final path = Path()
      ..moveTo(plot.left, plot.bottom)
      ..lineTo(plot.right, plot.top);
    for (final m in path.computeMetrics()) {
      for (var d = 0.0; d < m.length; d += 9) {
        canvas.drawPath(m.extractPath(d, math.min(d + 5, m.length)), diag);
      }
    }
    final r = Curves.easeOutBack.transform(reveal.value.clamp(0.0, 1.0));
    for (final d in geo.dots) {
      final color = palette.tone(d.over ? ChartTone.loss : ChartTone.primary);
      canvas.drawCircle(
        d.center,
        d.radius * r,
        Paint()..color = color.withValues(alpha: 0.78),
      );
      canvas.drawCircle(
        d.center,
        d.radius * r,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = color
          ..strokeWidth = 1.25,
      );
    }
    geo.axes.paintLabels(canvas);
  }

  @override
  bool shouldRepaint(_CalPainter old) =>
      old.geo != geo || old.palette != palette;
}

class _SelPainter extends CustomPainter {
  _SelPainter({required this.geo, required this.palette, required this.sel})
    : super(repaint: sel);
  final _CalGeo geo;
  final ChartPalette palette;
  final ValueNotifier<int?> sel;

  @override
  void paint(Canvas canvas, Size size) {
    final i = sel.value;
    if (i == null) return;
    for (final d in geo.dots) {
      if (d.index != i) continue;
      canvas.drawCircle(
        d.center,
        d.radius + 3,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = palette.colors.foreground
          ..strokeWidth = 1.5,
      );
    }
  }

  @override
  bool shouldRepaint(_SelPainter old) => old.geo != geo;
}
