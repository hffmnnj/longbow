import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui';

import 'chart_math.dart';

/// Ordered (Bayer) dithering, ported from the web dither kit
/// (`dither-kit/engine/dither-paint.ts`): the same 4x4 matrix, the same two
/// brightness tiers (lit cells bright, unlit cells at 40% of that), the same
/// density ramp (sparse at the value line, dense at the baseline).
///
/// The cell grid is anchored to canvas space (cell centers sit on multiples of
/// `cell`), so the pattern never shimmers when data changes and every cell
/// edge lands on a physical pixel when [ditherCellSize] is used.

/// 4x4 Bayer matrix, row-major, normalised to (0, 1): (v + 0.5) / 16.
const List<double> kBayer4 = [
  0.5 / 16, 8.5 / 16, 2.5 / 16, 10.5 / 16, //
  12.5 / 16, 4.5 / 16, 14.5 / 16, 6.5 / 16, //
  3.5 / 16, 11.5 / 16, 1.5 / 16, 9.5 / 16, //
  15.5 / 16, 7.5 / 16, 13.5 / 16, 5.5 / 16,
];

/// Number of distinct alpha tiers a mask is quantised to (one draw call each).
const int kDitherTiers = 8;

/// Alpha of a dark cell relative to a lit one (web `OFF_TIER`).
const double kOffTier = 0.4;

/// Base brightness of a lit cell and how much density adds (web `alphaFloor`
/// and `alphaRange`).
const double kAlphaFloor = 0.3;
const double kAlphaRange = 0.7;

/// Bayer threshold for the cell at grid position ([gx], [gy]).
double ditherThreshold(int gx, int gy) => kBayer4[((gy & 3) << 2) | (gx & 3)];

/// Logical size of one dither cell: about 2dp, snapped to a whole number of
/// physical pixels so dots stay crisp at any [devicePixelRatio].
double ditherCellSize(double devicePixelRatio, {double target = 2}) {
  final dpr = devicePixelRatio <= 0 ? 1.0 : devicePixelRatio;
  final physical = math.max(2, (target * dpr).round());
  return physical / dpr;
}

/// Opacity (0..1) of the cell at grid position ([gx], [gy]).
///
/// [depth] is 0 at the value line and 1 at the baseline. Deeper cells are
/// brighter and more likely to be lit; shallow cells are mostly dark.
double ditherCellAlpha({
  required int gx,
  required int gy,
  required double depth,
  double maxAlpha = 1,
}) {
  final d = depth.clamp(0.0, 1.0);
  final k = kAlphaFloor + d * kAlphaRange;
  final lit = d > ditherThreshold(gx, gy);
  return (lit ? k : k * kOffTier) * maxAlpha;
}

/// Alpha quantised to tier 0 (skip) .. [kDitherTiers].
int ditherTier(double alpha) =>
    (alpha * kDitherTiers).round().clamp(0, kDitherTiers);

/// The painted cells of a dither fill, grouped by alpha tier. `tiers[t]` holds
/// x,y pairs (cell centers) with alpha `(t + 1) / kDitherTiers`.
class DitherMask {
  const DitherMask(this.cell, this.tiers);

  static final DitherMask empty = DitherMask(
    1,
    List<Float32List>.generate(kDitherTiers, (_) => Float32List(0)),
  );

  /// Cell edge length in logical pixels.
  final double cell;
  final List<Float32List> tiers;

  int get cellCount => tiers.fold(0, (s, t) => s + t.length ~/ 2);
}

/// Accumulates cells into tiers.
class DitherMaskBuilder {
  DitherMaskBuilder(this.cell)
    : _tiers = List.generate(kDitherTiers, (_) => <double>[]);

  final double cell;
  final List<List<double>> _tiers;

  void add(int gx, int gy, double alpha) {
    final t = ditherTier(alpha);
    if (t == 0) return;
    _tiers[t - 1]
      ..add((gx + 0.5) * cell)
      ..add((gy + 0.5) * cell);
  }

  /// Fills [rect] with cells whose depth runs from 0 at the tip edge to 1 at
  /// the opposite (base) edge. [tipAtTop] true means the tip is the top edge
  /// (positive vertical bars); false puts it at the bottom (negative bars).
  /// Cells whose center is outside [rect] are skipped.
  void addVerticalBar(
    Rect rect, {
    required bool tipAtTop,
    double maxAlpha = 0.85,
  }) {
    if (rect.width <= 0 || rect.height <= 0) return;
    final gx0 = (rect.left / cell - 0.5).ceil();
    final gx1 = (rect.right / cell - 0.5).floor();
    final gy0 = (rect.top / cell - 0.5).ceil();
    final gy1 = (rect.bottom / cell - 0.5).floor();
    for (var gx = gx0; gx <= gx1; gx++) {
      for (var gy = gy0; gy <= gy1; gy++) {
        final cy = (gy + 0.5) * cell;
        final f = (cy - rect.top) / rect.height;
        add(
          gx,
          gy,
          ditherCellAlpha(
            gx: gx,
            gy: gy,
            depth: tipAtTop ? f : 1 - f,
            maxAlpha: maxAlpha,
          ),
        );
      }
    }
  }

  /// Like [addVerticalBar] for a horizontal bar: the tip is the right edge
  /// when [tipAtRight], otherwise the left edge.
  void addHorizontalBar(
    Rect rect, {
    required bool tipAtRight,
    double maxAlpha = 0.85,
  }) {
    if (rect.width <= 0 || rect.height <= 0) return;
    final gx0 = (rect.left / cell - 0.5).ceil();
    final gx1 = (rect.right / cell - 0.5).floor();
    final gy0 = (rect.top / cell - 0.5).ceil();
    final gy1 = (rect.bottom / cell - 0.5).floor();
    for (var gx = gx0; gx <= gx1; gx++) {
      final cx = (gx + 0.5) * cell;
      final f = (cx - rect.left) / rect.width;
      for (var gy = gy0; gy <= gy1; gy++) {
        add(
          gx,
          gy,
          ditherCellAlpha(
            gx: gx,
            gy: gy,
            depth: tipAtRight ? 1 - f : f,
            maxAlpha: maxAlpha,
          ),
        );
      }
    }
  }

  DitherMask build() =>
      DitherMask(cell, [for (final t in _tiers) Float32List.fromList(t)]);
}

/// Dither fill between a polyline (the value line) and the bottom of [plot].
///
/// Pure and deterministic: the same inputs always give the same cells. Only
/// columns whose center lies inside the polyline's x extent and the plot are
/// filled.
DitherMask buildDitherMask({
  required Rect plot,
  required double cell,
  required Polyline line,
  double maxAlpha = 0.85,
}) {
  if (line.length < 2 || plot.width <= 0 || plot.height <= 0 || cell <= 0) {
    return DitherMask.empty;
  }
  final lo = math.max(plot.left, line.xs.first);
  final hi = math.min(plot.right, line.xs.last);
  final b = DitherMaskBuilder(cell);
  final gx0 = (lo / cell - 0.5).ceil();
  final gx1 = (hi / cell - 0.5).floor();
  for (var gx = gx0; gx <= gx1; gx++) {
    final cx = (gx + 0.5) * cell;
    final top = polylineYAt(line, cx).clamp(plot.top, plot.bottom);
    final span = plot.bottom - top;
    if (span <= 0) continue;
    final gy0 = (top / cell - 0.5).ceil();
    final gy1 = (plot.bottom / cell - 0.5).floor();
    for (var gy = gy0; gy <= gy1; gy++) {
      final cy = (gy + 0.5) * cell;
      b.add(
        gx,
        gy,
        ditherCellAlpha(
          gx: gx,
          gy: gy,
          depth: (cy - top) / span,
          maxAlpha: maxAlpha,
        ),
      );
    }
  }
  return b.build();
}

/// Draws [mask] in [color]; [opacity] scales every tier (used to fade a fill
/// in). One `drawRawPoints` call per non-empty tier.
void paintDitherMask(
  Canvas canvas,
  DitherMask mask,
  Color color, {
  double opacity = 1,
}) {
  if (opacity <= 0) return;
  final paint = Paint()
    ..isAntiAlias = false
    ..strokeCap = StrokeCap.square
    ..strokeWidth = mask.cell;
  for (var t = 0; t < kDitherTiers; t++) {
    final pts = mask.tiers[t];
    if (pts.isEmpty) continue;
    paint.color = color.withValues(alpha: (t + 1) / kDitherTiers * opacity);
    canvas.drawRawPoints(PointMode.points, pts, paint);
  }
}
