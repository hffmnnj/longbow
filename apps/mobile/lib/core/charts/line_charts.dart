import 'package:flutter/material.dart';

import 'cartesian_chart.dart';
import 'chart_palette.dart';
import 'chart_scrub.dart';

/// A single series drawn as a crisp line over an ordered-dither area fill.
///
/// Optional dashed [benchmark] line (for example SPY), [referenceLines] (stop,
/// entry) and [markers] (buy and sell triangles on given indices).
///
/// Size: fills the available width; height is [height] (default 180) unless
/// the parent gives a bounded height. Scrubbing: see [scrubMode].
///
/// Animation: the line draws in over 400 ms and the fill fades in; data changes
/// morph over 250 ms. Both are skipped when the system disables animations.
class DitherAreaChart extends StatelessWidget {
  const DitherAreaChart({
    super.key,
    required this.values,
    this.labels,
    this.benchmark,
    this.benchmarkName = '',
    this.name = '',
    this.referenceLines = const [],
    this.markers = const [],
    this.tone,
    this.fill = true,
    this.valueFormatter,
    this.onScrub,
    this.showReadout = true,
    this.semanticsLabel,
    this.height = 180,
    this.scrubMode = ChartScrubMode.drag,
    this.enableHaptics = true,
    this.includeZero = false,
    this.maxXLabels = 4,
    this.showAxes = true,
    this.animate = true,
  });

  /// One value per x slot. NaN and infinite values are skipped.
  final List<double> values;

  /// One x label per value (dates, days). At most [maxXLabels] are shown.
  final List<String>? labels;

  /// A second dashed comparison series, same x slots as [values].
  final List<double>? benchmark;

  /// Readout name of the benchmark, such as "SPY".
  final String benchmarkName;

  /// Readout name of the main series, such as "Equity".
  final String name;

  /// Horizontal rules at values (stop, entry, start capital).
  final List<ChartReferenceLine> referenceLines;

  /// Buy and sell triangles on the main series.
  final List<ChartMarker> markers;

  /// Line and fill color. Null picks gain when the series ends at or above its
  /// start and loss otherwise; pass a tone for non-money series (VIX is warn,
  /// lab runs are lab).
  final ChartTone? tone;

  /// Draw the dither fill. Turn off for a plain line.
  final bool fill;

  /// Formats axis ticks and readout values. Keep it stable across rebuilds
  /// (top-level function or tear-off); a change alone does not rebuild the
  /// cached axis labels.
  final String Function(double)? valueFormatter;

  /// Called with the scrubbed data index, and null when the finger lifts.
  final ValueChanged<int?>? onScrub;

  /// Show the built-in value and label bubble while scrubbing.
  final bool showReadout;

  /// Spoken summary. Defaults to start, end, change, low and high.
  final String? semanticsLabel;

  /// Chart height in dp.
  final double? height;

  /// How a scrub starts; see [ChartScrubMode].
  final ChartScrubMode scrubMode;

  /// Selection haptic when the scrub lands on a new point.
  final bool enableHaptics;

  /// Stretch the y range to include zero.
  final bool includeZero;

  /// Upper bound on x labels (default 4).
  final int maxXLabels;

  /// Draw y/x labels and grid. Small boxes drop them anyway.
  final bool showAxes;

  /// Turn off the entry and morph animations for this chart.
  final bool animate;

  @override
  Widget build(BuildContext context) {
    return CartesianChartCore(
      lines: [
        ChartLine(values: values, name: name, tone: tone, fill: fill),
        if (benchmark != null)
          ChartLine(values: benchmark!, name: benchmarkName, dashed: true),
      ],
      labels: labels,
      referenceLines: referenceLines,
      markers: markers,
      valueFormatter: valueFormatter,
      onScrub: onScrub,
      showReadout: showReadout,
      semanticsLabel: semanticsLabel,
      height: height,
      scrubMode: scrubMode,
      enableHaptics: enableHaptics,
      includeZero: includeZero,
      maxXLabels: maxXLabels,
      showAxes: showAxes,
      animate: animate,
    );
  }
}

/// Several named lines on one scale with a legend row above: the lab compare
/// chart and any "A against B" view.
///
/// Lines are plain (no dither). Give each [ChartLine] a [ChartLine.name]; the
/// legend and the scrub readout use it. Lines may differ in length; x slots
/// follow the longest.
class MultiLineChart extends StatelessWidget {
  const MultiLineChart({
    super.key,
    required this.lines,
    this.labels,
    this.referenceLines = const [],
    this.valueFormatter,
    this.onScrub,
    this.showReadout = true,
    this.semanticsLabel,
    this.height = 200,
    this.scrubMode = ChartScrubMode.drag,
    this.enableHaptics = true,
    this.maxXLabels = 4,
    this.animate = true,
  });

  /// The series, drawn in order.
  final List<ChartLine> lines;

  /// One x label per slot (for example "D1"). At most [maxXLabels] are shown.
  final List<String>? labels;

  /// Rules such as the normalised start value (100).
  final List<ChartReferenceLine> referenceLines;

  final String Function(double)? valueFormatter;

  /// Scrubbed slot index, null on release.
  final ValueChanged<int?>? onScrub;
  final bool showReadout;

  /// Spoken summary. Defaults to a summary of the first line.
  final String? semanticsLabel;

  /// Height of the plot (the legend adds its own height above).
  final double height;
  final ChartScrubMode scrubMode;
  final bool enableHaptics;
  final int maxXLabels;
  final bool animate;

  @override
  Widget build(BuildContext context) {
    final palette = ChartPalette.of(context);
    final c = palette.colors;
    final resolved = [
      for (var i = 0; i < lines.length; i++)
        ChartLine(
          values: lines[i].values,
          name: lines[i].name,
          tone:
              lines[i].tone ??
              ChartPalette.cycle[i % ChartPalette.cycle.length],
          dashed: lines[i].dashed,
          strokeWidth: lines[i].strokeWidth,
          dots: lines[i].dots,
        ),
    ];
    final legend = <Widget>[
      for (final l in resolved)
        if (l.name.isNotEmpty)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 14,
                height: 3,
                child: CustomPaint(
                  painter: _LegendSwatch(palette.tone(l.tone!), l.dashed),
                ),
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  l.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall
                      ?.copyWith(color: c.mutedForeground),
                ),
              ),
            ],
          ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (legend.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Wrap(spacing: 14, runSpacing: 4, children: legend),
          ),
        CartesianChartCore(
          lines: resolved,
          labels: labels,
          referenceLines: referenceLines,
          valueFormatter: valueFormatter,
          onScrub: onScrub,
          showReadout: showReadout,
          semanticsLabel: semanticsLabel,
          height: height,
          scrubMode: scrubMode,
          enableHaptics: enableHaptics,
          maxXLabels: maxXLabels,
          animate: animate,
        ),
      ],
    );
  }
}

class _LegendSwatch extends CustomPainter {
  _LegendSwatch(this.color, this.dashed);
  final Color color;
  final bool dashed;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = color
      ..strokeWidth = 2;
    final y = size.height / 2;
    if (!dashed) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), p);
      return;
    }
    canvas.drawLine(Offset(0, y), Offset(5, y), p);
    canvas.drawLine(Offset(8, y), Offset(size.width, y), p);
  }

  @override
  bool shouldRepaint(_LegendSwatch old) =>
      old.color != color || old.dashed != dashed;
}

/// A small categorical line chart: the Treasury yield curve, a term structure,
/// anything where x is a name rather than a time. Dots mark every point and the
/// scrub snaps to categories.
///
/// [labels] and [values] must line up one to one. At most [maxXLabels] (default
/// 4, evenly spread, never overlapping) category names are printed; the scrub
/// readout always shows the full name.
class CurveChart extends StatelessWidget {
  const CurveChart({
    super.key,
    required this.labels,
    required this.values,
    this.tone = ChartTone.primary,
    this.name = '',
    this.valueFormatter,
    this.onScrub,
    this.showReadout = true,
    this.semanticsLabel,
    this.height = 150,
    this.scrubMode = ChartScrubMode.drag,
    this.enableHaptics = true,
    this.maxXLabels = 4,
    this.animate = true,
  });

  /// Category names, such as tenors (1M, 2Y, 10Y).
  final List<String> labels;
  final List<double> values;
  final ChartTone tone;
  final String name;
  final String Function(double)? valueFormatter;

  /// Scrubbed category index, null on release.
  final ValueChanged<int?>? onScrub;
  final bool showReadout;

  /// Spoken summary. Defaults to first and last category with values.
  final String? semanticsLabel;
  final double height;
  final ChartScrubMode scrubMode;
  final bool enableHaptics;
  final int maxXLabels;
  final bool animate;

  @override
  Widget build(BuildContext context) {
    return CartesianChartCore(
      lines: [ChartLine(values: values, name: name, tone: tone, dots: true)],
      labels: labels,
      valueFormatter: valueFormatter,
      onScrub: onScrub,
      showReadout: showReadout,
      semanticsLabel: semanticsLabel,
      height: height,
      scrubMode: scrubMode,
      enableHaptics: enableHaptics,
      maxXLabels: maxXLabels,
      animate: animate,
    );
  }
}
