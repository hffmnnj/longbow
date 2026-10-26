import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'chart_format.dart';
import 'chart_palette.dart';
import 'dither.dart';

/// Fraction of [max] that [value] fills, clamped to 0..1. Non-finite values
/// and a non-positive [max] give 0.
double barFraction(double value, double max) {
  if (!value.isFinite || !max.isFinite || max <= 0) return 0;
  return (value / max).clamp(0.0, 1.0);
}

/// A single horizontal meter: a solid bar that dissolves into a dither tail at
/// its end, with an optional tick [marker] for a cap or a threshold. Covers
/// the web `DitherBar`: position exposure, sector weights against the cap,
/// market breadth against 50, VIX term structure, outcome counts. Breadth is
/// just a BarStrip with `marker: 50`.
///
/// Fills the available width; [height] defaults to 10dp. The fill grows in over
/// 400 ms on first draw and glides on value changes (skipped when the system
/// disables animations). Meaning is carried by [semanticsLabel], never by color.
class BarStrip extends StatefulWidget {
  const BarStrip({
    super.key,
    required this.value,
    required this.semanticsLabel,
    this.max = 100,
    this.tone = ChartTone.primary,
    this.marker,
    this.height = 10,
    this.animate = true,
  });

  /// The measured value, in the same units as [max].
  final double value;

  /// Value that fills the whole track. Values above it clamp.
  final double max;
  final ChartTone tone;

  /// A tick on the track in the same units as [value] (a cap or a limit).
  final double? marker;
  final double height;

  /// Spoken description, for example "AAPL 12.5% of equity".
  final String semanticsLabel;
  final bool animate;

  @override
  State<BarStrip> createState() => _BarStripState();
}

class _BarStripState extends State<BarStrip>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctl = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 400),
  );
  double _from = 0;
  late double _to = barFraction(widget.value, widget.max);
  bool _reduce = false;
  bool _started = false;

  double get _shown =>
      _from + (_to - _from) * Curves.easeOutCubic.transform(_ctl.value);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduce = MediaQuery.disableAnimationsOf(context) || !widget.animate;
    if (_reduce) {
      _from = _to;
      _ctl.value = 1;
    } else if (!_started) {
      _ctl.forward(from: 0);
    }
    _started = true;
  }

  @override
  void didUpdateWidget(BarStrip old) {
    super.didUpdateWidget(old);
    final next = barFraction(widget.value, widget.max);
    if (next == _to) return;
    _from = _reduce ? next : _shown;
    _to = next;
    if (_reduce) {
      _ctl.value = 1;
    } else {
      _ctl.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = ChartPalette.of(context);
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final marker = widget.marker == null
        ? null
        : barFraction(widget.marker!, widget.max);
    return Semantics(
      image: true,
      label: widget.semanticsLabel,
      child: ExcludeSemantics(
        child: RepaintBoundary(
          child: SizedBox(
            height: widget.height,
            width: double.infinity,
            child: CustomPaint(
              painter: _BarStripPainter(
                animation: _ctl,
                from: _from,
                to: _to,
                color: palette.tone(widget.tone),
                track: palette.colors.muted.withValues(alpha: 0.7),
                markerColor: palette.colors.foreground,
                marker: marker,
                cell: ditherCellSize(dpr),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BarStripPainter extends CustomPainter {
  _BarStripPainter({
    required this.animation,
    required this.from,
    required this.to,
    required this.color,
    required this.track,
    required this.markerColor,
    required this.marker,
    required this.cell,
  }) : super(repaint: animation);

  final Animation<double> animation;
  final double from;
  final double to;
  final Color color;
  final Color track;
  final Color markerColor;
  final double? marker;
  final double cell;

  static const double tail = 20;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width <= 0 || size.height <= 0) return;
    final rrect = RRect.fromRectAndRadius(
      Offset.zero & size,
      const Radius.circular(3),
    );
    canvas.save();
    canvas.clipRRect(rrect);
    canvas.drawRRect(rrect, Paint()..color = track);
    final f =
        from + (to - from) * Curves.easeOutCubic.transform(animation.value);
    final w = size.width * f;
    if (w > 0) {
      final tailW = f > 0.06 ? math.min(tail, w) : 0.0;
      final body = Rect.fromLTWH(0, 0, w - tailW, size.height);
      if (body.width > 0) canvas.drawRect(body, Paint()..color = color);
      if (tailW > 0) {
        final b = DitherMaskBuilder(cell)
          ..addHorizontalBar(
            Rect.fromLTWH(w - tailW, 0, tailW, size.height),
            tipAtRight: true,
            maxAlpha: 1,
          );
        paintDitherMask(canvas, b.build(), color);
      }
    }
    final m = marker;
    if (m != null) {
      final x = (size.width * m).clamp(1.0, size.width - 1);
      canvas.drawRect(
        Rect.fromLTWH(x - 1, 0, 2, size.height),
        Paint()..color = markerColor,
      );
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_BarStripPainter old) =>
      old.from != from ||
      old.to != to ||
      old.color != color ||
      old.track != track ||
      old.marker != marker ||
      old.cell != cell;
}

/// One row of a [BarStripList].
@immutable
class BarRow {
  const BarRow({
    required this.label,
    required this.value,
    required this.valueLabel,
    this.tone = ChartTone.primary,
    this.marker,
  });

  /// Left label, such as a symbol or sector. Ellipsized when long.
  final String label;
  final double value;

  /// Right-aligned text, such as "12.5%".
  final String valueLabel;
  final ChartTone tone;

  /// Tick in the same units as [value] (for example the sector cap).
  final double? marker;
}

/// Labelled [BarStrip] rows sharing one scale: sector weights, exposure,
/// order outcomes, VIX term structure. Label and value columns scale with the
/// text size so large text never clips the bar to nothing.
class BarStripList extends StatelessWidget {
  const BarStripList({
    super.key,
    required this.rows,
    this.max,
    this.labelWidth = 92,
    this.valueWidth = 52,
    this.rowGap = 8,
    this.animate = true,
  });

  final List<BarRow> rows;

  /// Value that fills a track. Null uses the largest row value or marker.
  final double? max;

  /// Width of the label column at text scale 1.
  final double labelWidth;

  /// Width of the value column at text scale 1.
  final double valueWidth;
  final double rowGap;
  final bool animate;

  @override
  Widget build(BuildContext context) {
    final c = ChartPalette.of(context).colors;
    final scaler = MediaQuery.textScalerOf(context);
    final top =
        max ??
        rows.fold<double>(0, (m, r) {
          var v = m;
          if (r.value.isFinite && r.value > v) v = r.value;
          if (r.marker != null && r.marker!.isFinite && r.marker! > v) {
            v = r.marker!;
          }
          return v;
        });
    final scale = top > 0 ? top : 1.0;
    if (rows.isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, box) {
        final avail = box.maxWidth.isFinite ? box.maxWidth : double.infinity;
        final labelW = math.min(scaler.scale(labelWidth), avail * 0.34);
        final valueW = math.min(scaler.scale(valueWidth), avail * 0.26);
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 0; i < rows.length; i++)
              Padding(
                padding: EdgeInsets.only(top: i == 0 ? 0 : rowGap),
                child: Semantics(
                  container: true,
                  label: '${rows[i].label} ${rows[i].valueLabel}',
                  child: ExcludeSemantics(
                    child: Row(
                      children: [
                        SizedBox(
                          width: labelW,
                          child: Text(
                            rows[i].label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(color: c.mutedForeground),
                          ),
                        ),
                        Expanded(
                          child: BarStrip(
                            value: rows[i].value,
                            max: scale,
                            tone: rows[i].tone,
                            marker: rows[i].marker,
                            semanticsLabel: rows[i].label,
                            animate: animate,
                          ),
                        ),
                        SizedBox(
                          width: valueW,
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerRight,
                            child: Text(
                              rows[i].valueLabel,
                              maxLines: 1,
                              style: chartTextStyle(c.foreground, size: 12.5),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// One row of [DiffBars].
@immutable
class DiffBarRow {
  const DiffBarRow({
    required this.label,
    required this.value,
    this.valueLabel,
    this.tone,
  });

  final String label;

  /// Signed value. NaN and infinite rows draw no bar.
  final double value;

  /// Right-aligned text. Defaults to the formatted value with a sign.
  final String? valueLabel;

  /// Null colors by sign: gain above zero, loss below, muted at zero.
  final ChartTone? tone;
}

/// Horizontal signed bars around a shared zero axis: excess return per run,
/// P&L per symbol, anything that goes both ways. Positive bars grow right in
/// gain, negative bars grow left in loss; the dither fades toward the tip, and
/// the tip carries a crisp cap so small values still read.
///
/// All rows share one scale. Rows are [rowHeight] tall (scaled with text size).
/// Not interactive: values sit in the right column.
class DiffBars extends StatelessWidget {
  const DiffBars({
    super.key,
    required this.rows,
    this.valueFormatter,
    this.labelWidth = 92,
    this.valueWidth = 56,
    this.rowHeight = 26,
    this.semanticsLabel,
  });

  final List<DiffBarRow> rows;

  /// Formats the default right-hand value text.
  final String Function(double)? valueFormatter;
  final double labelWidth;
  final double valueWidth;
  final double rowHeight;

  /// Spoken summary; defaults to listing every row.
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    final palette = ChartPalette.of(context);
    final c = palette.colors;
    final scaler = MediaQuery.textScalerOf(context);
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final fmt = valueFormatter ?? _signed;
    var lo = 0.0;
    var hi = 0.0;
    for (final r in rows) {
      if (!r.value.isFinite) continue;
      lo = math.min(lo, r.value);
      hi = math.max(hi, r.value);
    }
    if (hi == lo) hi = 1;
    final summary =
        semanticsLabel ??
        rows
            .map((r) => '${r.label} ${r.valueLabel ?? fmt(r.value)}')
            .join(', ');
    return Semantics(
      container: true,
      label: summary,
      child: ExcludeSemantics(
        child: LayoutBuilder(
          builder: (context, box) {
            final avail = box.maxWidth.isFinite
                ? box.maxWidth
                : double.infinity;
            final labelW = math.min(scaler.scale(labelWidth), avail * 0.32);
            final valueW = math.min(scaler.scale(valueWidth), avail * 0.26);
            return Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final r in rows)
                  SizedBox(
                    height: scaler.scale(rowHeight),
                    child: Row(
                      children: [
                        SizedBox(
                          width: labelW,
                          child: Text(
                            r.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(color: c.mutedForeground),
                          ),
                        ),
                        Expanded(
                          child: RepaintBoundary(
                            child: CustomPaint(
                              size: Size.infinite,
                              painter: _DiffPainter(
                                value: r.value,
                                lo: lo,
                                hi: hi,
                                color: palette.tone(
                                  r.tone ??
                                      (r.value > 0
                                          ? ChartTone.gain
                                          : r.value < 0
                                          ? ChartTone.loss
                                          : ChartTone.muted),
                                ),
                                axis: palette.axis,
                                cell: ditherCellSize(dpr),
                              ),
                            ),
                          ),
                        ),
                        SizedBox(
                          width: valueW,
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerRight,
                            child: Text(
                              r.valueLabel ?? fmt(r.value),
                              maxLines: 1,
                              style: chartTextStyle(c.foreground, size: 12.5),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }

  static String _signed(double v) => v.isFinite
      ? '${v > 0 ? '+' : ''}${formatChartNumber(v, fractionDigits: 1)}'
      : '\u2014';
}

class _DiffPainter extends CustomPainter {
  _DiffPainter({
    required this.value,
    required this.lo,
    required this.hi,
    required this.color,
    required this.axis,
    required this.cell,
  });

  final double value;
  final double lo;
  final double hi;
  final Color color;
  final Color axis;
  final double cell;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width <= 0 || size.height <= 0) return;
    const pad = 4.0;
    final w = size.width - pad * 2;
    double x(double v) => pad + (v - lo) / (hi - lo) * w;
    final zero = x(0);
    final bar = size.height * 0.5;
    final top = (size.height - bar) / 2;
    if (value.isFinite && value != 0) {
      final vx = x(value);
      final rect = value > 0
          ? Rect.fromLTRB(zero, top, vx, top + bar)
          : Rect.fromLTRB(vx, top, zero, top + bar);
      final b = DitherMaskBuilder(cell)
        ..addHorizontalBar(rect, tipAtRight: value > 0, maxAlpha: 0.9);
      paintDitherMask(canvas, b.build(), color);
      final capX = value > 0 ? vx - 1.5 : vx;
      canvas.drawRect(
        Rect.fromLTWH(capX, top, 1.5, bar),
        Paint()..color = color,
      );
    }
    canvas.drawLine(
      Offset(zero.roundToDouble() + 0.5, 0),
      Offset(zero.roundToDouble() + 0.5, size.height),
      Paint()
        ..color = axis
        ..strokeWidth = 1,
    );
  }

  @override
  bool shouldRepaint(_DiffPainter old) =>
      old.value != value ||
      old.lo != lo ||
      old.hi != hi ||
      old.color != color ||
      old.axis != axis ||
      old.cell != cell;
}
