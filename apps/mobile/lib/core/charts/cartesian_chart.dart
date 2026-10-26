import 'dart:math' as math;
import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';

import 'chart_axes.dart';
import 'chart_format.dart';
import 'chart_math.dart';
import 'chart_palette.dart';
import 'chart_scrub.dart';
import 'dither.dart';

/// One series on a cartesian chart.
@immutable
class ChartLine {
  const ChartLine({
    required this.values,
    this.name = '',
    this.tone,
    this.dashed = false,
    this.fill = false,
    this.strokeWidth = 1.75,
    this.dots = false,
  });

  /// One value per x slot. NaN and infinite values are skipped (the line
  /// connects across them) and never reach the scales.
  final List<double> values;

  /// Shown in the legend and the scrub readout.
  final String name;

  /// Color role; null picks one from the palette cycle (or gain/loss for the
  /// first line of a filled chart).
  final ChartTone? tone;

  /// Draw dashed (benchmarks).
  final bool dashed;

  /// Draw the dithered area fill under the line.
  final bool fill;
  final double strokeWidth;

  /// Draw a dot on every point (categorical curves).
  final bool dots;
}

/// A horizontal rule at a value, such as a stop or an entry price.
@immutable
class ChartReferenceLine {
  const ChartReferenceLine({
    required this.value,
    this.label = '',
    this.tone = ChartTone.muted,
    this.dashed = true,
  });

  final double value;
  final String label;
  final ChartTone tone;
  final bool dashed;
}

enum ChartMarkerKind { buy, sell, neutral }

/// A triangle (buy points up from below the line, sell points down from
/// above) or a dot on the line at a data index.
@immutable
class ChartMarker {
  const ChartMarker({
    required this.index,
    this.kind = ChartMarkerKind.neutral,
    this.label = '',
    this.lineIndex = 0,
  });

  final int index;
  final ChartMarkerKind kind;

  /// Spoken in the semantics summary.
  final String label;

  /// Which line the marker sits on.
  final int lineIndex;
}

// ---------------------------------------------------------------------------
// Geometry (cached per size, data, text scale, palette)
// ---------------------------------------------------------------------------

class _LineGeo {
  _LineGeo(this.spec, this.color, this.poly, this.plot, this.cell);

  final ChartLine spec;
  final Color color;
  final Polyline poly;
  final Rect plot;
  final double cell;

  late final Path path = _polyPath(poly);
  late final Path dashed = dashPath(path, 5, 4);
  late final List<PathMetric> metrics = path.computeMetrics().toList();
  late final DitherMask mask = spec.fill
      ? buildDitherMask(plot: plot, cell: cell, line: poly)
      : DitherMask.empty;
}

Path _polyPath(Polyline p) {
  final path = Path();
  if (p.isEmpty) return path;
  path.moveTo(p.xs[0], p.ys[0]);
  for (var i = 1; i < p.length; i++) {
    path.lineTo(p.xs[i], p.ys[i]);
  }
  return path;
}

/// Splits [src] into dashes. Allocation heavy; callers cache the result.
Path dashPath(Path src, double dash, double gap) {
  final out = Path();
  for (final m in src.computeMetrics()) {
    var d = 0.0;
    while (d < m.length) {
      out.addPath(m.extractPath(d, math.min(d + dash, m.length)), Offset.zero);
      d += dash + gap;
    }
  }
  return out;
}

class _RefGeo {
  _RefGeo(this.y, this.color, this.dashed, this.label);
  final double y;
  final Color color;
  final bool dashed;
  final TextPainter? label;
}

class _MarkerGeo {
  _MarkerGeo(this.x, this.y, this.kind);
  final double x;
  final double y;
  final ChartMarkerKind kind;
}

/// Everything the painters need, computed once per input set.
class _CartesianGeometry {
  _CartesianGeometry._({
    required this.size,
    required this.axes,
    required this.n,
    required this.empty,
    required this.lines,
    required this.refs,
    required this.markers,
    required this.snap,
  });

  final Size size;
  final AxisLayout axes;

  /// Number of x slots (longest series).
  final int n;

  /// True when no series has a finite value: draw the empty-state baseline.
  final bool empty;
  final List<_LineGeo> lines;
  final List<_RefGeo> refs;
  final List<_MarkerGeo> markers;

  /// Indices the scrub may land on (finite points of the primary series).
  final List<int> snap;

  Rect get plot => axes.plot;

  double xAt(int i) => n <= 1
      ? plot.center.dx
      : plot.left + i.clamp(0, n - 1) / (n - 1) * plot.width;

  /// y pixel of line [line] at data index [i], or null if there is no value.
  double? yAt(int line, int i) {
    if (line >= lines.length) return null;
    final v = lines[line].spec.values;
    if (i < 0 || i >= v.length || !v[i].isFinite) return null;
    return axes.yScale.map(v[i]);
  }

  /// Maps a local x to a scrub index (null when the chart has no data).
  int? indexAt(double dx) {
    if (empty || snap.isEmpty) return null;
    if (n <= 1) return snap.first;
    final f = ((dx - plot.left) / plot.width).clamp(0.0, 1.0);
    return nearestIndex(snap, (f * (n - 1)).round());
  }

  static _CartesianGeometry build({
    required Size size,
    required List<ChartLine> lines,
    required List<String>? labels,
    required List<ChartReferenceLine> refs,
    required List<ChartMarker> markers,
    required ChartPalette palette,
    required TextScaler textScaler,
    required double devicePixelRatio,
    required String Function(double)? format,
    required bool includeZero,
    required int maxXLabels,
    required bool showAxes,
  }) {
    var n = labels?.length ?? 0;
    for (final l in lines) {
      n = math.max(n, l.values.length);
    }
    final all = <double>[
      for (final l in lines) ...l.values,
      for (final r in refs) r.value,
    ];
    final hasData = lines.any((l) => l.values.any((v) => v.isFinite));
    final domain = paddedDomain(all, includeZero: includeZero);
    final axes = AxisLayout.compute(
      size: size,
      domainMin: domain.min,
      domainMax: domain.max,
      palette: palette,
      textScaler: textScaler,
      format: format,
      xLabelTexts: labels,
      xCount: n,
      maxXLabels: maxXLabels,
      showY: showAxes && hasData,
      showX: showAxes && hasData,
    );
    final cell = ditherCellSize(devicePixelRatio);
    final maxPoints = math.max(16, (axes.plot.width * 1.5).round());
    final primary = lines.indexWhere((l) => l.values.any((v) => v.isFinite));
    final primaryValues = primary < 0
        ? const <double>[]
        : lines[primary].values;
    final up = () {
      final idx = finiteIndices(primaryValues);
      return idx.length < 2 ||
          primaryValues[idx.last] >= primaryValues[idx.first];
    }();

    final geos = <_LineGeo>[];
    for (var i = 0; i < lines.length; i++) {
      final spec = lines[i];
      final tone =
          spec.tone ??
          (i == primary && !spec.dashed
              ? palette.autoTone(up)
              : spec.dashed
              ? ChartTone.muted
              : ChartPalette.cycle[i % ChartPalette.cycle.length]);
      final color = spec.dashed && spec.tone == null
          ? palette.benchmark
          : palette.tone(tone);
      geos.add(
        _LineGeo(
          spec,
          color,
          projectSeries(
            spec.values,
            n: n,
            left: axes.plot.left,
            right: axes.plot.right,
            yScale: axes.yScale,
            maxPoints: maxPoints,
          ),
          axes.plot,
          cell,
        ),
      );
    }

    final refGeos = <_RefGeo>[];
    for (final r in refs) {
      if (!r.value.isFinite) continue;
      final color = palette.tone(r.tone);
      refGeos.add(
        _RefGeo(
          axes.yScale.map(r.value),
          color,
          r.dashed,
          r.label.isEmpty
              ? null
              : (TextPainter(
                  text: TextSpan(
                    text: r.label,
                    style: chartTextStyle(color, size: 10),
                  ),
                  textDirection: TextDirection.ltr,
                  textScaler: textScaler,
                  maxLines: 1,
                )..layout()),
        ),
      );
    }

    final markerGeos = <_MarkerGeo>[];
    for (final m in markers) {
      if (m.lineIndex >= lines.length || m.index < 0) continue;
      final v = lines[m.lineIndex].values;
      if (m.index >= v.length || !v[m.index].isFinite) continue;
      final x = n <= 1
          ? axes.plot.center.dx
          : axes.plot.left + m.index / (n - 1) * axes.plot.width;
      markerGeos.add(_MarkerGeo(x, axes.yScale.map(v[m.index]), m.kind));
    }

    return _CartesianGeometry._(
      size: size,
      axes: axes,
      n: n,
      empty: !hasData,
      lines: geos,
      refs: refGeos,
      markers: markerGeos,
      snap: finiteIndices(primaryValues),
    );
  }

  void dispose() {
    axes.dispose();
    for (final r in refs) {
      r.label?.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
// Painters
// ---------------------------------------------------------------------------

class _DataPainter extends CustomPainter {
  _DataPainter({
    required this.geo,
    required this.prev,
    required this.palette,
    required this.reveal,
    required this.morph,
  }) : super(repaint: Listenable.merge([reveal, morph]));

  final _CartesianGeometry geo;
  final _CartesianGeometry? prev;
  final ChartPalette palette;
  final Animation<double> reveal;
  final Animation<double> morph;

  @override
  void paint(Canvas canvas, Size size) {
    final axes = geo.axes;
    final plot = geo.plot;
    axes.paintGrid(canvas);

    if (geo.empty) {
      final p = Paint()
        ..color = palette.axis
        ..strokeWidth = 1;
      final y = plot.center.dy;
      for (var x = plot.left; x < plot.right; x += 8) {
        canvas.drawLine(
          Offset(x, y),
          Offset(math.min(x + 4, plot.right), y),
          p,
        );
      }
      return;
    }

    final r = Curves.easeOutCubic.transform(reveal.value.clamp(0.0, 1.0));
    final old = prev;
    final morphing =
        old != null && !old.empty && old.size == geo.size && morph.value < 1;
    final m = morphing ? Curves.easeOutCubic.transform(morph.value) : 1.0;

    for (final ref in geo.refs) {
      final p = Paint()
        ..color = ref.color
        ..strokeWidth = 1.25;
      if (ref.dashed) {
        for (var x = plot.left; x < plot.right; x += 7) {
          canvas.drawLine(
            Offset(x, ref.y),
            Offset(math.min(x + 4, plot.right), ref.y),
            p,
          );
        }
      } else {
        canvas.drawLine(Offset(plot.left, ref.y), Offset(plot.right, ref.y), p);
      }
      ref.label?.paint(
        canvas,
        Offset(plot.left + 2, ref.y - ref.label!.height - 1),
      );
    }

    // Benchmarks and other plain lines first, filled lines on top.
    final order = [
      for (var i = 0; i < geo.lines.length; i++)
        if (!geo.lines[i].spec.fill) i,
      for (var i = 0; i < geo.lines.length; i++)
        if (geo.lines[i].spec.fill) i,
    ];
    for (final i in order) {
      final line = geo.lines[i];
      final from = morphing && i < old.lines.length ? old.lines[i].poly : null;
      final poly = from == null ? line.poly : lerpPolyline(from, line.poly, m);
      final stable = from == null;
      if (line.spec.fill) {
        final mask = stable
            ? line.mask
            : buildDitherMask(plot: plot, cell: line.cell, line: poly);
        paintDitherMask(canvas, mask, line.color, opacity: r);
      }
      final stroke = Paint()
        ..style = PaintingStyle.stroke
        ..color = line.color
        ..strokeWidth = line.spec.strokeWidth
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;
      if (poly.length == 1) {
        canvas.drawCircle(
          Offset(poly.xs[0], poly.ys[0]),
          3,
          Paint()..color = line.color,
        );
        continue;
      }
      final path = stable ? line.path : _polyPath(poly);
      if (line.spec.dashed) {
        canvas.drawPath(stable ? line.dashed : dashPath(path, 5, 4), stroke);
      } else if (r < 1) {
        final metrics = stable ? line.metrics : path.computeMetrics().toList();
        final trimmed = Path();
        for (final mt in metrics) {
          trimmed.addPath(mt.extractPath(0, mt.length * r), Offset.zero);
        }
        canvas.drawPath(trimmed, stroke);
      } else {
        canvas.drawPath(path, stroke);
      }
      if (line.spec.dots) {
        final dot = Paint()..color = line.color;
        for (var k = 0; k < poly.length; k++) {
          canvas.drawCircle(Offset(poly.xs[k], poly.ys[k]), 2.75, dot);
        }
      }
    }

    if (r > 0.6) {
      for (final mk in geo.markers) {
        _paintMarker(canvas, mk, palette, (r - 0.6) / 0.4);
      }
    }
    axes.paintLabels(canvas);
  }

  @override
  bool shouldRepaint(_DataPainter old) =>
      old.geo != geo || old.prev != prev || old.palette != palette;
}

void _paintMarker(
  Canvas canvas,
  _MarkerGeo m,
  ChartPalette palette,
  double opacity,
) {
  const half = 4.5;
  final color = switch (m.kind) {
    ChartMarkerKind.buy => palette.markerBuy,
    ChartMarkerKind.sell => palette.markerSell,
    ChartMarkerKind.neutral => palette.markerNeutral,
  }.withValues(alpha: opacity);
  final paint = Paint()..color = color;
  switch (m.kind) {
    case ChartMarkerKind.buy:
      final top = m.y + 5;
      canvas.drawPath(
        Path()
          ..moveTo(m.x, top)
          ..lineTo(m.x - half, top + 8)
          ..lineTo(m.x + half, top + 8)
          ..close(),
        paint,
      );
    case ChartMarkerKind.sell:
      final bottom = m.y - 5;
      canvas.drawPath(
        Path()
          ..moveTo(m.x, bottom)
          ..lineTo(m.x - half, bottom - 8)
          ..lineTo(m.x + half, bottom - 8)
          ..close(),
        paint,
      );
    case ChartMarkerKind.neutral:
      canvas.drawCircle(Offset(m.x, m.y), 3.5, paint);
  }
}

class _ScrubPainter extends CustomPainter {
  _ScrubPainter({required this.geo, required this.palette, required this.scrub})
    : super(repaint: scrub);

  final _CartesianGeometry geo;
  final ChartPalette palette;
  final ValueNotifier<int?> scrub;

  @override
  void paint(Canvas canvas, Size size) {
    final i = scrub.value;
    if (i == null || geo.empty) return;
    final x = geo.xAt(i);
    final plot = geo.plot;
    canvas.drawLine(
      Offset(x, plot.top),
      Offset(x, plot.bottom),
      Paint()
        ..color = palette.crosshair
        ..strokeWidth = 1,
    );
    for (var k = 0; k < geo.lines.length; k++) {
      final y = geo.yAt(k, i);
      if (y == null) continue;
      canvas.drawCircle(Offset(x, y), 5.5, Paint()..color = palette.dotRing);
      canvas.drawCircle(Offset(x, y), 3.5, Paint()..color = geo.lines[k].color);
    }
  }

  @override
  bool shouldRepaint(_ScrubPainter old) =>
      old.geo != geo || old.palette != palette;
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

/// The shared engine behind [DitherAreaChart], [MultiLineChart] and
/// [CurveChart]. Prefer those.
class CartesianChartCore extends StatefulWidget {
  const CartesianChartCore({
    super.key,
    required this.lines,
    this.labels,
    this.referenceLines = const [],
    this.markers = const [],
    this.valueFormatter,
    this.onScrub,
    this.showReadout = true,
    this.interactive = true,
    this.semanticsLabel,
    this.height,
    this.scrubMode = ChartScrubMode.drag,
    this.enableHaptics = true,
    this.includeZero = false,
    this.maxXLabels = 4,
    this.showAxes = true,
    this.animate = true,
    this.hapticsOverride,
  });

  final List<ChartLine> lines;
  final List<String>? labels;
  final List<ChartReferenceLine> referenceLines;
  final List<ChartMarker> markers;
  final String Function(double)? valueFormatter;
  final ValueChanged<int?>? onScrub;
  final bool showReadout;
  final bool interactive;
  final String? semanticsLabel;
  final double? height;
  final ChartScrubMode scrubMode;
  final bool enableHaptics;
  final bool includeZero;
  final int maxXLabels;
  final bool showAxes;
  final bool animate;
  final ScrubHaptics? hapticsOverride;

  @override
  State<CartesianChartCore> createState() => _CartesianChartCoreState();
}

bool _sameLines(List<ChartLine> a, List<ChartLine> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    final x = a[i];
    final y = b[i];
    if (x.name != y.name ||
        x.tone != y.tone ||
        x.dashed != y.dashed ||
        x.fill != y.fill ||
        x.dots != y.dots ||
        x.strokeWidth != y.strokeWidth) {
      return false;
    }
    if (identical(x.values, y.values)) continue;
    if (x.values.length != y.values.length) return false;
    for (var k = 0; k < x.values.length; k++) {
      final p = x.values[k];
      final q = y.values[k];
      if (p != q && !(p.isNaN && q.isNaN)) return false;
    }
  }
  return true;
}

bool _sameList<T>(List<T>? a, List<T>? b, bool Function(T, T) eq) {
  if (identical(a, b)) return true;
  if (a == null || b == null || a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (!eq(a[i], b[i])) return false;
  }
  return true;
}

class _CartesianChartCoreState extends State<CartesianChartCore>
    with TickerProviderStateMixin {
  late final AnimationController _reveal = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 400),
  );
  late final AnimationController _morph = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 250),
    value: 1,
  );
  final ValueNotifier<int?> _scrub = ValueNotifier<int?>(null);

  _CartesianGeometry? _geo;
  _CartesianGeometry? _prev;
  Object? _key;
  int _version = 0;
  bool _reduce = false;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduce = MediaQuery.disableAnimationsOf(context) || !widget.animate;
    if (_reduce) {
      _reveal.value = 1;
      _morph.value = 1;
      _prev = null;
    } else if (!_started) {
      _reveal.forward(from: 0);
    }
    _started = true;
  }

  @override
  void didUpdateWidget(CartesianChartCore old) {
    super.didUpdateWidget(old);
    final w = widget;
    final same =
        _sameLines(old.lines, w.lines) &&
        _sameList<String>(old.labels, w.labels, (a, b) => a == b) &&
        _sameList<ChartReferenceLine>(
          old.referenceLines,
          w.referenceLines,
          (a, b) =>
              a.value == b.value &&
              a.label == b.label &&
              a.tone == b.tone &&
              a.dashed == b.dashed,
        ) &&
        _sameList<ChartMarker>(
          old.markers,
          w.markers,
          (a, b) =>
              a.index == b.index &&
              a.kind == b.kind &&
              a.lineIndex == b.lineIndex,
        ) &&
        old.includeZero == w.includeZero &&
        old.maxXLabels == w.maxXLabels &&
        old.showAxes == w.showAxes;
    if (same) return;
    _version++;
    _scrub.value = null;
    final current = _geo;
    if (!_reduce && current != null && !current.empty) {
      _prev = current;
      _morph.forward(from: 0);
    } else {
      _prev = null;
    }
  }

  @override
  void dispose() {
    _reveal.dispose();
    _morph.dispose();
    _scrub.dispose();
    _geo?.dispose();
    super.dispose();
  }

  String _semantics(_CartesianGeometry geo) {
    final w = widget;
    if (w.semanticsLabel != null) return w.semanticsLabel!;
    final primary = w.lines.indexWhere((l) => l.values.any((v) => v.isFinite));
    final base = summarizeSeries(
      primary < 0 ? const [] : w.lines[primary].values,
      name: 'Chart',
      format: w.valueFormatter,
    );
    final buys = w.markers.where((m) => m.kind == ChartMarkerKind.buy).length;
    final sells = w.markers.where((m) => m.kind == ChartMarkerKind.sell).length;
    final extra = [
      if (buys > 0) '$buys ${buys == 1 ? 'buy' : 'buys'}',
      if (sells > 0) '$sells ${sells == 1 ? 'sell' : 'sells'}',
    ];
    return extra.isEmpty ? base : '$base, ${extra.join(', ')}';
  }

  Widget _readout(BuildContext context, int i) {
    final lb = ChartPalette.of(context).colors;
    final fmt = widget.valueFormatter ?? formatChartNumber;
    final labels = widget.labels;
    final multi = widget.lines.where((l) => l.name.isNotEmpty).length > 1;
    final geo = _geo;
    final rows = <Widget>[
      if (labels != null && i < labels.length)
        Text(labels[i], style: chartTextStyle(lb.mutedForeground)),
      for (var k = 0; k < widget.lines.length; k++)
        if (i < widget.lines[k].values.length &&
            widget.lines[k].values[i].isFinite)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (multi && geo != null) ...[
                Container(width: 8, height: 3, color: geo.lines[k].color),
                const SizedBox(width: 4),
              ],
              if (multi) ...[
                Text(
                  '${widget.lines[k].name} ',
                  style: chartTextStyle(lb.mutedForeground),
                ),
              ],
              Text(
                fmt(widget.lines[k].values[i]),
                style: chartTextStyle(
                  lb.foreground,
                  size: 12.5,
                  weight: FontWeight.w600,
                ),
              ),
            ],
          ),
    ];
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: rows,
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = ChartPalette.of(context);
    final scaler = MediaQuery.textScalerOf(context);
    final dpr = MediaQuery.devicePixelRatioOf(context);

    Widget body = LayoutBuilder(
      builder: (context, box) {
        final w = box.maxWidth.isFinite ? box.maxWidth : 0.0;
        final h = box.maxHeight.isFinite
            ? box.maxHeight
            : (widget.height ?? 180);
        if (w <= 0 || h <= 0) return const SizedBox.shrink();
        final size = Size(w, h);
        final key = (size, dpr, scaler, palette, _version);
        if (_geo == null || _key != key) {
          final old = _geo;
          _geo = _CartesianGeometry.build(
            size: size,
            lines: widget.lines,
            labels: widget.labels,
            refs: widget.referenceLines,
            markers: widget.markers,
            palette: palette,
            textScaler: scaler,
            devicePixelRatio: dpr,
            format: widget.valueFormatter,
            includeZero: widget.includeZero,
            maxXLabels: widget.maxXLabels,
            showAxes: widget.showAxes,
          );
          _key = key;
          if (old != null && !identical(old, _prev)) old.dispose();
        }
        final geo = _geo!;
        final prev = identical(_prev, geo) ? null : _prev;
        Widget stack = SizedBox(
          width: w,
          height: h,
          child: Stack(
            children: [
              Positioned.fill(
                child: RepaintBoundary(
                  child: CustomPaint(
                    painter: _DataPainter(
                      geo: geo,
                      prev: prev,
                      palette: palette,
                      reveal: _reveal,
                      morph: _morph,
                    ),
                  ),
                ),
              ),
              Positioned.fill(
                child: RepaintBoundary(
                  child: CustomPaint(
                    painter: _ScrubPainter(
                      geo: geo,
                      palette: palette,
                      scrub: _scrub,
                    ),
                  ),
                ),
              ),
              if (widget.showReadout && widget.interactive && !geo.empty)
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
        if (widget.interactive && !geo.empty) {
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
        return Semantics(
          container: true,
          image: true,
          label: _semantics(geo),
          child: ExcludeSemantics(child: stack),
        );
      },
    );

    if (widget.height != null) {
      body = SizedBox(height: widget.height, child: body);
    }
    return RepaintBoundary(child: body);
  }
}
