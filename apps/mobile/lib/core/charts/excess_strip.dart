import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'chart_format.dart';
import 'chart_palette.dart';

/// One run on an [ExcessStrip].
@immutable
class ExcessDot {
  const ExcessDot({
    required this.id,
    required this.label,
    required this.variant,
    required this.value,
  });

  final String id;

  /// Run name for the spoken summary, such as the scenario.
  final String label;

  /// Lane this dot sits in.
  final String variant;

  /// Excess return over the benchmark, in points. Null or non-finite dots are
  /// not plotted.
  final double? value;
}

class _Placed {
  _Placed(this.dot, this.center, this.color);
  final ExcessDot dot;
  final Offset center;
  final Color color;
}

/// Excess return per run, one lane per variant, on a shared axis with a dashed
/// zero line. Gain right of zero, loss left. Covers the web `ExcessStrip`.
///
/// The widget sizes its own height from the number of lanes (scaled with the
/// text size), so give it only a width. Tap a dot to receive it through
/// [onDotTap] (touch slop 24dp). Not animated.
class ExcessStrip extends StatelessWidget {
  const ExcessStrip({
    super.key,
    required this.runs,
    required this.variants,
    this.onDotTap,
    this.valueFormatter,
    this.semanticsLabel,
  });

  final List<ExcessDot> runs;

  /// Lane order, top to bottom.
  final List<String> variants;
  final ValueChanged<ExcessDot>? onDotTap;

  /// Formats dots and axis ends; default is a signed one-decimal number.
  final String Function(double)? valueFormatter;
  final String? semanticsLabel;

  static String _signed(double v) =>
      '${v > 0 ? '+' : ''}${formatChartNumber(v, fractionDigits: 1)}';

  @override
  Widget build(BuildContext context) {
    final palette = ChartPalette.of(context);
    final scaler = MediaQuery.textScalerOf(context);
    final fmt = valueFormatter ?? _signed;
    final plotted = runs
        .where(
          (r) =>
              r.value != null &&
              r.value!.isFinite &&
              variants.contains(r.variant),
        )
        .toList();
    final laneH = scaler.scale(32);
    final footerH = scaler.scale(18);
    final height = 8 + variants.length * laneH + footerH;
    final label =
        semanticsLabel ??
        (plotted.isEmpty
            ? 'Excess return per run, no closed runs'
            : 'Excess return per run: ${plotted.map((r) => '${r.label} ${fmt(r.value!)}').join(', ')}');
    return Semantics(
      container: true,
      image: true,
      label: label,
      child: ExcludeSemantics(
        child: RepaintBoundary(
          child: LayoutBuilder(
            builder: (context, box) {
              final w = box.maxWidth.isFinite ? box.maxWidth : 0.0;
              if (w <= 0 || variants.isEmpty) return const SizedBox.shrink();
              final painter = _ExcessPainter(
                runs: plotted,
                variants: variants,
                palette: palette,
                scaler: scaler,
                laneH: laneH,
                footerH: footerH,
                fmt: fmt,
              );
              return GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTapUp: onDotTap == null
                    ? null
                    : (d) {
                        final hit = painter.dotAt(
                          Size(w, height),
                          d.localPosition,
                        );
                        if (hit != null) onDotTap!(hit);
                      },
                child: CustomPaint(size: Size(w, height), painter: painter),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _ExcessPainter extends CustomPainter {
  _ExcessPainter({
    required this.runs,
    required this.variants,
    required this.palette,
    required this.scaler,
    required this.laneH,
    required this.footerH,
    required this.fmt,
  });

  final List<ExcessDot> runs;
  final List<String> variants;
  final ChartPalette palette;
  final TextScaler scaler;
  final double laneH;
  final double footerH;
  final String Function(double) fmt;

  static const double pad = 12;
  static const double dotR = 4.5;

  ({double lo, double hi}) get _range {
    var lo = 0.0;
    var hi = 0.0;
    for (final r in runs) {
      lo = math.min(lo, r.value!);
      hi = math.max(hi, r.value!);
    }
    if (hi == lo) hi = lo + 1;
    return (lo: lo, hi: hi);
  }

  List<_Placed> _place(Size size) {
    final range = _range;
    final span = range.hi - range.lo;
    final out = <_Placed>[];
    for (var gi = 0; gi < variants.length; gi++) {
      final lane = runs.where((r) => r.variant == variants[gi]).toList();
      final laneTop = 8 + gi * laneH;
      final mid = laneTop + laneH * 0.62;
      for (var i = 0; i < lane.length; i++) {
        final v = lane[i].value!;
        final x = pad + (v - range.lo) / span * (size.width - pad * 2);
        final y = lane.length == 1 ? mid : mid + (i.isEven ? -3.5 : 3.5);
        out.add(
          _Placed(
            lane[i],
            Offset(x, y),
            palette.tone(
              v > 0
                  ? ChartTone.gain
                  : v < 0
                  ? ChartTone.loss
                  : ChartTone.muted,
            ),
          ),
        );
      }
    }
    return out;
  }

  ExcessDot? dotAt(Size size, Offset p) {
    _Placed? best;
    var bestD = 24.0;
    for (final d in _place(size)) {
      final dist = (d.center - p).distance;
      if (dist <= bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best?.dot;
  }

  TextPainter _text(String s, Color c) => TextPainter(
    text: TextSpan(text: s, style: chartTextStyle(c)),
    textDirection: TextDirection.ltr,
    textScaler: scaler,
    maxLines: 1,
  )..layout();

  @override
  void paint(Canvas canvas, Size size) {
    final range = _range;
    final span = range.hi - range.lo;
    final zeroX = pad + (0 - range.lo) / span * (size.width - pad * 2);
    final bottom = 8 + variants.length * laneH;
    final zero = Paint()
      ..color = palette.axis
      ..strokeWidth = 1;
    for (var y = 4.0; y < bottom; y += 6) {
      canvas.drawLine(
        Offset(zeroX, y),
        Offset(zeroX, math.min(y + 3, bottom)),
        zero,
      );
    }
    for (var gi = 0; gi < variants.length; gi++) {
      final t = _text(variants[gi], palette.axisText);
      t.paint(canvas, Offset(pad, 8 + gi * laneH));
      t.dispose();
    }
    for (final d in _place(size)) {
      canvas.drawCircle(
        d.center,
        dotR,
        Paint()..color = d.color.withValues(alpha: 0.9),
      );
    }
    final y = bottom + 2;
    if (runs.isEmpty) return;
    final left = _text(fmt(range.lo < 0 ? range.lo : 0), palette.axisText);
    final mid = _text('0', palette.axisText);
    final right = _text(fmt(range.hi > 0 ? range.hi : 0), palette.axisText);
    left.paint(canvas, Offset(pad, y));
    final midMin = pad + left.width + 6;
    final midMax = math.max(
      midMin,
      size.width - pad - right.width - mid.width - 6,
    );
    mid.paint(canvas, Offset((zeroX - mid.width / 2).clamp(midMin, midMax), y));
    right.paint(canvas, Offset(size.width - pad - right.width, y));
    left.dispose();
    mid.dispose();
    right.dispose();
  }

  @override
  bool shouldRepaint(_ExcessPainter old) {
    if (old.palette != palette ||
        old.scaler != scaler ||
        old.variants.length != variants.length ||
        old.runs.length != runs.length) {
      return true;
    }
    for (var i = 0; i < runs.length; i++) {
      if (old.runs[i].value != runs[i].value ||
          old.runs[i].variant != runs[i].variant) {
        return true;
      }
    }
    for (var i = 0; i < variants.length; i++) {
      if (old.variants[i] != variants[i]) return true;
    }
    return false;
  }
}
