import 'dart:math' as math;
import 'dart:typed_data';

/// Pure chart math: scales, ticks, decimation, label picking, polyline
/// resampling. Nothing here touches Flutter widgets, so all of it is unit
/// tested directly.

/// Indices of the finite (not NaN, not infinite) values.
List<int> finiteIndices(List<double> values) => [
  for (var i = 0; i < values.length; i++)
    if (values[i].isFinite) i,
];

/// A linear map from a data domain to a pixel range.
///
/// A degenerate domain (min == max) maps everything to the middle of the
/// range, which is what a flat series should look like.
class LinearScale {
  const LinearScale({
    required this.domainMin,
    required this.domainMax,
    required this.rangeStart,
    required this.rangeEnd,
  });

  final double domainMin;
  final double domainMax;
  final double rangeStart;
  final double rangeEnd;

  double map(double v) {
    final span = domainMax - domainMin;
    if (span == 0) return (rangeStart + rangeEnd) / 2;
    return rangeStart + (v - domainMin) / span * (rangeEnd - rangeStart);
  }

  double invert(double r) {
    final span = rangeEnd - rangeStart;
    if (span == 0) return domainMin;
    return domainMin + (r - rangeStart) / span * (domainMax - domainMin);
  }
}

/// Up to [count] "nice" tick values inside [min]..[max] (inclusive).
///
/// Picks the smallest step from {1, 2, 2.5, 5} × 10^k that yields at most
/// [count] ticks, so 0..100 with 5 ticks gives 0, 25, 50, 75, 100. Returns an
/// empty list for a non-positive [count] or non-finite bounds, and a single
/// tick for a flat range.
List<double> niceTicks(double min, double max, int count) {
  if (count <= 0 || !min.isFinite || !max.isFinite) return const [];
  if (max < min) {
    final t = min;
    min = max;
    max = t;
  }
  if (min == max) return [min];
  final range = max - min;
  final startExp = (math.log(range / count) / math.ln10).floor() - 1;
  const mantissas = [1.0, 2.0, 2.5, 5.0];
  final want = math.min(2, count);
  for (var e = startExp; e < startExp + 8; e++) {
    for (final m in mantissas) {
      final step = e >= 0 ? m * math.pow(10, e) : m / math.pow(10, -e);
      final first = (min / step).ceil();
      final last = (max / step).floor();
      final n = last - first + 1;
      if (n < want || n > count) continue;
      final decimals = (e >= 0 ? 0 : -e) + (m == 2.5 && e <= 0 ? 1 : 0);
      return [for (var k = first; k <= last; k++) _clean(k * step, decimals)];
    }
  }
  return [(min + max) / 2];
}

double _clean(double v, int decimals) {
  final r = double.parse(v.toStringAsFixed(decimals.clamp(0, 12)));
  return r == 0 ? 0.0 : r;
}

/// Fraction digits needed to print ticks that are [step] apart.
int decimalsForStep(double step) {
  if (!step.isFinite || step <= 0) return 0;
  var s = step;
  var d = 0;
  while ((s - s.roundToDouble()).abs() > 1e-9 && d < 6) {
    s *= 10;
    d++;
  }
  return d;
}

/// A padded y domain around the finite [values].
///
/// No finite values give 0..1. A flat series gets a symmetric span so its line
/// sits in the middle. [includeZero] stretches the domain to contain zero.
({double min, double max}) paddedDomain(
  Iterable<double> values, {
  double padTop = 0.08,
  double padBottom = 0.06,
  bool includeZero = false,
}) {
  var lo = double.infinity;
  var hi = double.negativeInfinity;
  for (final v in values) {
    if (!v.isFinite) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo > hi) return (min: 0.0, max: 1.0);
  if (includeZero) {
    lo = math.min(lo, 0);
    hi = math.max(hi, 0);
  }
  if (lo == hi) {
    final half = lo == 0 ? 1.0 : lo.abs() * 0.05;
    return (min: lo - half, max: hi + half);
  }
  final span = hi - lo;
  return (
    min: includeZero && lo == 0 ? 0.0 : lo - span * padBottom,
    max: includeZero && hi == 0 ? 0.0 : hi + span * padTop,
  );
}

/// Min-max decimation: the indices to keep so that at most [maxPoints] remain.
///
/// The first and last finite points are always kept. The interior is split
/// into equal buckets and each keeps its lowest and highest finite value, so
/// spikes survive. Non-finite values are skipped. Indices are ascending and
/// refer to the input list.
List<int> decimateMinMax(List<double> values, int maxPoints) {
  final finite = finiteIndices(values);
  if (finite.length <= maxPoints || maxPoints < 4) {
    return finite.length <= maxPoints || maxPoints < 2
        ? finite
        : [finite.first, finite.last];
  }
  final interior = finite.length - 2;
  final buckets = (maxPoints - 2) ~/ 2;
  final out = <int>[finite.first];
  for (var b = 0; b < buckets; b++) {
    final from = 1 + (b * interior) ~/ buckets;
    final to = 1 + ((b + 1) * interior) ~/ buckets;
    if (to <= from) continue;
    var lo = finite[from];
    var hi = finite[from];
    for (var k = from + 1; k < to; k++) {
      final i = finite[k];
      if (values[i] < values[lo]) lo = i;
      if (values[i] > values[hi]) hi = i;
    }
    if (lo == hi) {
      out.add(lo);
    } else if (lo < hi) {
      out
        ..add(lo)
        ..add(hi);
    } else {
      out
        ..add(hi)
        ..add(lo);
    }
  }
  out.add(finite.last);
  return out;
}

/// Evenly spaced label indices for an axis of [n] categories, at most
/// [maxLabels] of them, none overlapping.
///
/// [widthOf] gives the painted width of the label at an index. The first label
/// is left aligned at the plot edge and the last is right aligned, the rest
/// are centered on their position. Falls back to fewer labels until they fit
/// with at least [gap] between neighbours.
List<int> pickLabelIndices(
  int n,
  int maxLabels,
  double plotWidth,
  double Function(int index) widthOf, {
  double gap = 8,
}) {
  if (n <= 0 || maxLabels <= 0) return const [];
  if (n == 1) return const [0];
  for (var k = math.min(maxLabels, n); k >= 2; k--) {
    final idx = <int>{
      for (var j = 0; j < k; j++) ((j * (n - 1)) / (k - 1)).round(),
    }.toList();
    var fits = true;
    double? prevEnd;
    for (var j = 0; j < idx.length && fits; j++) {
      final w = widthOf(idx[j]);
      final x = idx[j] / (n - 1) * plotWidth;
      final start = j == 0
          ? 0.0
          : j == idx.length - 1
          ? plotWidth - w
          : x - w / 2;
      if (prevEnd != null && start < prevEnd + gap) fits = false;
      prevEnd = start + w;
    }
    if (fits) return idx;
  }
  return [n - 1];
}

/// A polyline in plot space: ascending [xs] with matching [ys], plus the
/// original data index of every point.
class Polyline {
  const Polyline(this.idx, this.xs, this.ys);
  static const Polyline empty = Polyline(<int>[], <double>[], <double>[]);
  final List<int> idx;
  final List<double> xs;
  final List<double> ys;
  int get length => xs.length;
  bool get isEmpty => xs.isEmpty;
}

/// Projects [values] to a polyline. Index i of [n] maps to x across
/// [left]..[right] (a single-point axis maps to the middle). Non-finite values
/// are dropped but keep their x slot, so labels stay aligned. Long series are
/// decimated to [maxPoints].
Polyline projectSeries(
  List<double> values, {
  required int n,
  required double left,
  required double right,
  required LinearScale yScale,
  required int maxPoints,
}) {
  final keep = decimateMinMax(values, maxPoints);
  final xs = Float64List(keep.length);
  final ys = Float64List(keep.length);
  for (var k = 0; k < keep.length; k++) {
    final i = keep[k];
    xs[k] = n <= 1 ? (left + right) / 2 : left + i / (n - 1) * (right - left);
    ys[k] = yScale.map(values[i]);
  }
  return Polyline(keep, xs, ys);
}

double _yAt(Polyline p, double x, [int hint = 0]) {
  if (x <= p.xs.first) return p.ys.first;
  var j = hint;
  while (j < p.xs.length - 1 && p.xs[j + 1] < x) {
    j++;
  }
  if (j >= p.xs.length - 1) return p.ys.last;
  final dx = p.xs[j + 1] - p.xs[j];
  if (dx == 0) return p.ys[j + 1];
  return p.ys[j] + (x - p.xs[j]) / dx * (p.ys[j + 1] - p.ys[j]);
}

/// Blends polyline [a] into [b] at [t] (0 gives a, 1 gives b).
///
/// Both are resampled to a common count along their own x extent, so series of
/// different lengths still morph smoothly.
Polyline lerpPolyline(
  Polyline a,
  Polyline b,
  double t, {
  int maxSamples = 240,
}) {
  if (t <= 0 && !a.isEmpty) return a;
  if (t >= 1 || a.isEmpty) return b;
  if (b.isEmpty) return a;
  final m = math.min(math.max(a.length, b.length), maxSamples);
  if (m < 2) {
    return Polyline(
      b.idx,
      [a.xs.first + (b.xs.first - a.xs.first) * t],
      [a.ys.first + (b.ys.first - a.ys.first) * t],
    );
  }
  final xs = Float64List(m);
  final ys = Float64List(m);
  var ha = 0;
  var hb = 0;
  for (var k = 0; k < m; k++) {
    final u = k / (m - 1);
    final xa = a.xs.first + (a.xs.last - a.xs.first) * u;
    final xb = b.xs.first + (b.xs.last - b.xs.first) * u;
    while (ha < a.length - 2 && a.xs[ha + 1] < xa) {
      ha++;
    }
    while (hb < b.length - 2 && b.xs[hb + 1] < xb) {
      hb++;
    }
    final ya = _yAt(a, xa, ha);
    final yb = _yAt(b, xb, hb);
    xs[k] = xa + (xb - xa) * t;
    ys[k] = ya + (yb - ya) * t;
  }
  return Polyline(const [], xs, ys);
}

/// y of the polyline at [x] (clamped to the ends). The polyline must not be
/// empty.
double polylineYAt(Polyline p, double x) => _yAt(p, x);

/// The index in [sortedIdx] (ascending) closest to [target].
int nearestIndex(List<int> sortedIdx, int target) {
  var lo = 0;
  var hi = sortedIdx.length - 1;
  while (lo < hi) {
    final mid = (lo + hi) >> 1;
    if (sortedIdx[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo > 0 &&
      (target - sortedIdx[lo - 1]).abs() <= (sortedIdx[lo] - target).abs()) {
    return sortedIdx[lo - 1];
  }
  return sortedIdx[lo];
}

/// Simple moving average. Entries before [period] values exist are NaN so the
/// result lines up with the input.
List<double> simpleMovingAverage(List<double> values, int period) {
  final out = List<double>.filled(values.length, double.nan);
  if (period < 1) return out;
  var sum = 0.0;
  for (var i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
