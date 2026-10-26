import 'package:flutter/material.dart';

import 'chart_format.dart';
import 'chart_math.dart';
import 'chart_palette.dart';

/// Minimal axes shared by the cartesian charts: at most 4 y labels on the
/// right, at most 4 x labels below, both in Plex Mono 10.5sp with tabular
/// figures in the muted foreground color, plus faint horizontal grid rules.
///
/// Built once per (size, domain, text scale) and cached by the chart State.
class AxisLayout {
  AxisLayout._({
    required this.size,
    required this.plot,
    required this.yScale,
    required this.ticks,
    required this.yLabels,
    required this.xIndices,
    required this.xLabels,
    required this.xPositions,
    required this.gridColor,
    required this.labelBottom,
  });

  /// Whole chart box.
  final Size size;

  /// Where data is drawn (inside the axis labels).
  final Rect plot;

  /// Maps data values to y pixels.
  final LinearScale yScale;
  final List<double> ticks;
  final List<TextPainter> yLabels;
  final List<int> xIndices;
  final List<TextPainter> xLabels;
  final List<double> xPositions;
  final Color gridColor;
  final double labelBottom;

  /// Axes are dropped below these sizes so a small chart stays legible.
  static const double minWidthForAxes = 120;
  static const double minHeightForYAxis = 72;
  static const double minHeightForXAxis = 96;

  static AxisLayout compute({
    required Size size,
    required double domainMin,
    required double domainMax,
    required ChartPalette palette,
    required TextScaler textScaler,
    String Function(double)? format,
    List<String>? xLabelTexts,
    int xCount = 0,
    double Function(Rect plot, int i)? xAt,
    int maxXLabels = 4,
    bool showY = true,
    bool showX = true,
    bool showGrid = true,
    EdgeInsets padding = const EdgeInsets.fromLTRB(2, 8, 2, 2),
  }) {
    final wide = size.width >= minWidthForAxes;
    final y = showY && wide && size.height >= minHeightForYAxis;
    final x =
        showX &&
        wide &&
        size.height >= minHeightForXAxis &&
        xLabelTexts != null &&
        xLabelTexts.isNotEmpty &&
        xCount > 0;
    final style = chartTextStyle(palette.axisText);

    TextPainter paint(String s) => TextPainter(
      text: TextSpan(text: s, style: style),
      textDirection: TextDirection.ltr,
      textScaler: textScaler,
      maxLines: 1,
    )..layout();

    final xBand = x ? paint('0').height + 6 : 0.0;
    final plotH = (size.height - padding.top - padding.bottom - xBand).clamp(
      1.0,
      double.infinity,
    );
    final count = (plotH / 44).floor().clamp(2, 4);
    final ticks = y ? niceTicks(domainMin, domainMax, count) : const <double>[];
    final fmt = format ?? axisFormatter(ticks);
    final yLabels = [for (final t in ticks) paint(fmt(t))];
    final axisW = yLabels.isEmpty
        ? 0.0
        : yLabels.map((p) => p.width).reduce((a, b) => a > b ? a : b) + 8;
    final plot = Rect.fromLTRB(
      padding.left,
      padding.top,
      (size.width - padding.right - axisW).clamp(
        padding.left + 1,
        double.infinity,
      ),
      padding.top + plotH,
    );
    final scale = LinearScale(
      domainMin: domainMin,
      domainMax: domainMax,
      rangeStart: plot.bottom,
      rangeEnd: plot.top,
    );

    var xIdx = const <int>[];
    var xPaint = <TextPainter>[];
    var xPos = <double>[];
    if (x) {
      final cache = <int, TextPainter>{};
      TextPainter at(int i) => cache.putIfAbsent(
        i,
        () => paint(i < xLabelTexts.length ? xLabelTexts[i] : ''),
      );
      // Overlap is judged on the evenly spaced fractions of the axis, so use
      // the generic picker on the category count.
      xIdx = pickLabelIndices(
        xCount,
        maxXLabels,
        plot.width,
        (i) => at(i).width,
      );
      xPaint = [for (final i in xIdx) at(i)];
      xPos = [
        for (final i in xIdx)
          xAt != null
              ? xAt(plot, i)
              : xCount <= 1
              ? plot.center.dx
              : plot.left + i / (xCount - 1) * plot.width,
      ];
    }
    return AxisLayout._(
      size: size,
      plot: plot,
      yScale: scale,
      ticks: ticks,
      yLabels: yLabels,
      xIndices: xIdx,
      xLabels: xPaint,
      xPositions: xPos,
      gridColor: showGrid ? palette.grid : const Color(0x00000000),
      labelBottom: plot.bottom,
    );
  }

  /// Horizontal grid rules at each tick.
  void paintGrid(Canvas canvas) {
    if (ticks.isEmpty || gridColor.a == 0) return;
    final p = Paint()
      ..color = gridColor
      ..strokeWidth = 1;
    for (final t in ticks) {
      final y = yScale.map(t).roundToDouble() + 0.5;
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), p);
    }
  }

  /// Y labels hugging the right edge, x labels under the plot.
  void paintLabels(Canvas canvas) {
    for (var i = 0; i < yLabels.length; i++) {
      final l = yLabels[i];
      final y = (yScale.map(ticks[i]) - l.height / 2).clamp(
        0.0,
        (labelBottom - l.height).clamp(0.0, double.infinity),
      );
      l.paint(canvas, Offset(size.width - l.width - 2, y));
    }
    for (var i = 0; i < xLabels.length; i++) {
      final l = xLabels[i];
      final dx = (xPositions[i] - l.width / 2).clamp(
        plot.left,
        (plot.right - l.width).clamp(plot.left, double.infinity),
      );
      l.paint(canvas, Offset(dx, plot.bottom + 4));
    }
  }

  void dispose() {
    for (final l in yLabels) {
      l.dispose();
    }
    for (final l in xLabels) {
      l.dispose();
    }
  }
}
