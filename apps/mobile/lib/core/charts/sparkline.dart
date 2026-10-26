import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'chart_format.dart';
import 'chart_math.dart';
import 'chart_palette.dart';
import 'dither.dart';

/// A tiny, non-interactive trend: a line over a light dither fill, for list
/// rows and cards. One cheap `CustomPainter`; the path and dither mask are
/// computed once per (size, data, devicePixelRatio) and reused.
///
/// Size: [width] by [height] (default 64 by 24), clamped to the parent's
/// constraints. Pass `width: double.infinity` to fill a row. Fewer than two
/// finite values draw a flat dashed placeholder instead.
class Sparkline extends StatefulWidget {
  const Sparkline({
    super.key,
    required this.values,
    this.benchmark,
    this.tone,
    this.filled = true,
    this.width = 64,
    this.height = 24,
    this.strokeWidth = 1.5,
    this.semanticsLabel,
  });

  /// Points left to right. NaN and infinite values are skipped.
  final List<double> values;

  /// Optional dashed comparison series on the same scale.
  final List<double>? benchmark;

  /// Null picks gain when the series ends at or above its start, else loss.
  final ChartTone? tone;

  /// Draw the dither fill under the line.
  final bool filled;
  final double width;
  final double height;
  final double strokeWidth;

  /// Spoken summary. Defaults to start, end and change.
  final String? semanticsLabel;

  @override
  State<Sparkline> createState() => _SparklineState();
}

class _SparkGeo {
  _SparkGeo(this.main, this.bench, this.mask, this.up, this.size);
  final Path? main;
  final Path? bench;
  final DitherMask mask;
  final bool up;
  final Size size;
}

bool _sameValues(List<double>? a, List<double>? b) {
  if (identical(a, b)) return true;
  if (a == null || b == null || a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i] && !(a[i].isNaN && b[i].isNaN)) return false;
  }
  return true;
}

class _SparklineState extends State<Sparkline> {
  _SparkGeo? _geo;
  Size? _size;
  double? _dpr;
  List<double>? _values;
  List<double>? _bench;
  bool? _filled;

  _SparkGeo _resolve(Size size, double dpr) {
    final w = widget;
    final fresh =
        _geo == null ||
        _size != size ||
        _dpr != dpr ||
        _filled != w.filled ||
        !_sameValues(_values, w.values) ||
        !_sameValues(_bench, w.benchmark);
    if (!fresh) return _geo!;
    final plot = Rect.fromLTRB(2, 3, size.width - 2, size.height - 3);
    final n = math.max(w.values.length, w.benchmark?.length ?? 0);
    final domain = paddedDomain(
      [...w.values, ...?w.benchmark],
      padTop: 0.1,
      padBottom: 0.1,
    );
    final scale = LinearScale(
      domainMin: domain.min,
      domainMax: domain.max,
      rangeStart: plot.bottom,
      rangeEnd: plot.top,
    );
    final maxPoints = math.max(8, (plot.width * 1.5).round());
    Polyline project(List<double> v) => projectSeries(
      v,
      n: n,
      left: plot.left,
      right: plot.right,
      yScale: scale,
      maxPoints: maxPoints,
    );
    final main = project(w.values);
    final idx = finiteIndices(w.values);
    final up = idx.length < 2 || w.values[idx.last] >= w.values[idx.first];
    final bench = w.benchmark == null ? null : project(w.benchmark!);
    final geo = _SparkGeo(
      main.length >= 2 ? _path(main) : null,
      bench != null && bench.length >= 2 ? dashPathSimple(_path(bench)) : null,
      w.filled && main.length >= 2
          ? buildDitherMask(
              plot: plot,
              cell: ditherCellSize(dpr),
              line: main,
              maxAlpha: 0.7,
            )
          : DitherMask.empty,
      up,
      size,
    );
    _geo = geo;
    _size = size;
    _dpr = dpr;
    _values = w.values;
    _bench = w.benchmark;
    _filled = w.filled;
    return geo;
  }

  static Path _path(Polyline p) {
    final path = Path()..moveTo(p.xs[0], p.ys[0]);
    for (var i = 1; i < p.length; i++) {
      path.lineTo(p.xs[i], p.ys[i]);
    }
    return path;
  }

  @override
  Widget build(BuildContext context) {
    final palette = ChartPalette.of(context);
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final label =
        widget.semanticsLabel ?? summarizeSeries(widget.values, name: 'Trend');
    return Semantics(
      image: true,
      label: label,
      child: ExcludeSemantics(
        child: RepaintBoundary(
          child: SizedBox(
            width: widget.width,
            height: widget.height,
            child: LayoutBuilder(
              builder: (context, box) {
                final w = box.maxWidth.isFinite ? box.maxWidth : widget.width;
                final h = box.maxHeight.isFinite
                    ? box.maxHeight
                    : widget.height;
                if (w <= 4 || h <= 6) return const SizedBox.shrink();
                final geo = _resolve(Size(w, h), dpr);
                return CustomPaint(
                  size: Size(w, h),
                  painter: _SparkPainter(
                    geo: geo,
                    palette: palette,
                    tone: widget.tone,
                    strokeWidth: widget.strokeWidth,
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _SparkPainter extends CustomPainter {
  _SparkPainter({
    required this.geo,
    required this.palette,
    required this.tone,
    required this.strokeWidth,
  });

  final _SparkGeo geo;
  final ChartPalette palette;
  final ChartTone? tone;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final main = geo.main;
    if (main == null) {
      final p = Paint()
        ..color = palette.axis
        ..strokeWidth = 1;
      final y = size.height / 2;
      for (var x = 2.0; x < size.width - 2; x += 6) {
        canvas.drawLine(
          Offset(x, y),
          Offset(math.min(x + 3, size.width - 2), y),
          p,
        );
      }
      return;
    }
    final color = palette.tone(tone ?? palette.autoTone(geo.up));
    paintDitherMask(canvas, geo.mask, color);
    final bench = geo.bench;
    if (bench != null) {
      canvas.drawPath(
        bench,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = palette.benchmark
          ..strokeWidth = 1.25,
      );
    }
    canvas.drawPath(
      main,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = color
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_SparkPainter old) =>
      old.geo != geo ||
      old.palette != palette ||
      old.tone != tone ||
      old.strokeWidth != strokeWidth;
}

/// Dashes a path (3 on, 3 off).
Path dashPathSimple(Path src) {
  final out = Path();
  for (final m in src.computeMetrics()) {
    for (var d = 0.0; d < m.length; d += 6) {
      out.addPath(m.extractPath(d, math.min(d + 3, m.length)), Offset.zero);
    }
  }
  return out;
}
