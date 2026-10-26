@Tags(['charts'])
library;

import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/charts/chart_format.dart';
import 'package:longbow/core/charts/chart_math.dart';

void main() {
  group('niceTicks', () {
    test('0..100 with 5 ticks is quarters', () {
      expect(niceTicks(0, 100, 5), [0, 25, 50, 75, 100]);
    });

    test('3..97 with 4 ticks picks the densest step that fits', () {
      expect(niceTicks(3, 97, 4), [20, 40, 60, 80]);
    });

    test('fractional range has clean decimals, no float noise', () {
      expect(niceTicks(0, 1, 5), [0, 0.25, 0.5, 0.75, 1]);
      expect(niceTicks(0.1, 0.4, 4), [0.1, 0.2, 0.3, 0.4]);
    });

    test('a zero crossing includes exactly zero', () {
      final t = niceTicks(-50, 50, 5);
      expect(t, [-40, -20, 0, 20, 40]);
      expect(t.contains(0), isTrue);
    });

    test('negative-only range', () {
      expect(niceTicks(-100, -20, 5), [-100, -80, -60, -40, -20]);
    });

    test('never returns more than count ticks or ticks outside the range', () {
      final rng = math.Random(7);
      for (var i = 0; i < 300; i++) {
        final a = (rng.nextDouble() - 0.5) * math.pow(10, rng.nextInt(7) - 2);
        final b =
            a + rng.nextDouble() * math.pow(10, rng.nextInt(7) - 2) + 1e-9;
        final count = 1 + rng.nextInt(5);
        final t = niceTicks(a, b, count);
        expect(t.length, lessThanOrEqualTo(count), reason: '$a..$b x$count');
        for (final v in t) {
          expect(v, inInclusiveRange(a - 1e-9, b + 1e-9), reason: '$a..$b');
        }
        if (t.length >= 3) {
          final step = t[1] - t[0];
          for (var k = 2; k < t.length; k++) {
            expect(t[k] - t[k - 1], closeTo(step, step.abs() * 1e-6));
          }
        }
      }
    });

    test('flat range gives that single value', () {
      expect(niceTicks(5, 5, 4), [5]);
    });

    test('non-finite bounds or non-positive count give nothing', () {
      expect(niceTicks(double.nan, 5, 4), isEmpty);
      expect(niceTicks(0, double.infinity, 4), isEmpty);
      expect(niceTicks(0, 10, 0), isEmpty);
    });

    test('reversed bounds are treated as min..max', () {
      expect(niceTicks(100, 0, 5), [0, 25, 50, 75, 100]);
    });
  });

  group('decimateMinMax', () {
    test('returns every finite index when the series already fits', () {
      expect(decimateMinMax([1, 2, 3, 4], 10), [0, 1, 2, 3]);
    });

    test('keeps first, last, and the min and max of every bucket', () {
      // 22 points, 12 allowed: 5 interior buckets of 4 points (indices 1..20).
      final v = [for (var i = 0; i < 22; i++) ((i * 7) % 11).toDouble()];
      final kept = decimateMinMax(v, 12);
      expect(kept.first, 0);
      expect(kept.last, 21);
      for (var b = 0; b < 5; b++) {
        final from = 1 + b * 4;
        final bucket = [for (var i = from; i < from + 4; i++) i];
        final lo = bucket.reduce((a, c) => v[c] < v[a] ? c : a);
        final hi = bucket.reduce((a, c) => v[c] > v[a] ? c : a);
        expect(kept, contains(lo), reason: 'bucket $b min');
        expect(kept, contains(hi), reason: 'bucket $b max');
      }
      expect(kept.length, lessThanOrEqualTo(12));
      expect(kept, orderedEquals([...kept]..sort()));
      expect(kept.toSet().length, kept.length);
    });

    test(
      '2000 points shrink under the budget but keep the global extremes',
      () {
        final v = [
          for (var i = 0; i < 2000; i++)
            math.sin(i / 37) * 10 + (i % 97) * 0.01,
        ];
        v[1234] = 99; // a spike must survive
        v[777] = -99;
        final kept = decimateMinMax(v, 300);
        expect(kept.length, lessThanOrEqualTo(300));
        expect(kept, containsAll([0, 1999, 1234, 777]));
      },
    );

    test('skips NaN and infinite values', () {
      final v = <double>[
        1,
        double.nan,
        5,
        double.infinity,
        3,
        9,
        2,
        8,
        4,
        7,
        6,
      ];
      final kept = decimateMinMax(v, 6);
      for (final i in kept) {
        expect(v[i].isFinite, isTrue);
      }
    });

    test('empty and tiny inputs do not throw', () {
      expect(decimateMinMax([], 10), isEmpty);
      expect(decimateMinMax([3], 10), [0]);
      expect(decimateMinMax([1, 2, 3, 4, 5, 6], 2), [0, 5]);
    });
  });

  group('LinearScale', () {
    const s = LinearScale(
      domainMin: 0,
      domainMax: 10,
      rangeStart: 100,
      rangeEnd: 0,
    );

    test('maps the domain onto an inverted pixel range', () {
      expect(s.map(0), 100);
      expect(s.map(10), 0);
      expect(s.map(2.5), 75);
    });

    test('invert is the inverse of map', () {
      for (final v in [0.0, 1.3, 7.7, 10.0]) {
        expect(s.invert(s.map(v)), closeTo(v, 1e-9));
      }
    });

    test('a flat domain maps to the middle of the range', () {
      const flat = LinearScale(
        domainMin: 5,
        domainMax: 5,
        rangeStart: 80,
        rangeEnd: 20,
      );
      expect(flat.map(5), 50);
    });
  });

  group('paddedDomain', () {
    test('pads both sides of a real range', () {
      final d = paddedDomain([10, 20], padTop: 0.1, padBottom: 0.05);
      expect(d.min, closeTo(9.5, 1e-9));
      expect(d.max, closeTo(21, 1e-9));
    });

    test('a flat series is centered', () {
      final d = paddedDomain([42, 42, 42]);
      final scale = LinearScale(
        domainMin: d.min,
        domainMax: d.max,
        rangeStart: 100,
        rangeEnd: 0,
      );
      expect(scale.map(42), closeTo(50, 1e-9));
    });

    test('flat zero still has a span', () {
      final d = paddedDomain([0, 0]);
      expect(d.max - d.min, greaterThan(0));
    });

    test('ignores NaN and infinity; no data gives 0..1', () {
      expect(paddedDomain([double.nan, double.infinity]), (min: 0.0, max: 1.0));
      final d = paddedDomain([double.nan, 1, 3, double.negativeInfinity]);
      expect(d.min, lessThan(1));
      expect(d.max, greaterThan(3));
    });

    test('includeZero stretches an all-positive range to zero', () {
      final d = paddedDomain([5, 9], includeZero: true);
      expect(d.min, 0);
    });
  });

  group('pickLabelIndices', () {
    double w(int _) => 30;

    test('uses the full budget when labels fit', () {
      expect(pickLabelIndices(10, 4, 300, w), [0, 3, 6, 9]);
    });

    test('drops labels instead of overlapping', () {
      final idx = pickLabelIndices(10, 4, 100, w);
      expect(idx.length, lessThan(4));
      _expectNoOverlap(idx, 10, 100, w);
    });

    test('never overlaps for many widths', () {
      for (final plot in [60.0, 90.0, 140.0, 260.0]) {
        for (final width in [20.0, 45.0, 80.0]) {
          final idx = pickLabelIndices(31, 4, plot, (_) => width);
          expect(idx.length, lessThanOrEqualTo(4));
          if (idx.length > 1) _expectNoOverlap(idx, 31, plot, (_) => width);
        }
      }
    });

    test('degenerate counts', () {
      expect(pickLabelIndices(0, 4, 100, w), isEmpty);
      expect(pickLabelIndices(1, 4, 100, w), [0]);
      expect(pickLabelIndices(5, 0, 100, w), isEmpty);
      expect(pickLabelIndices(2, 4, 100, w), [0, 1]);
    });
  });

  group('projectSeries', () {
    const scale = LinearScale(
      domainMin: 0,
      domainMax: 10,
      rangeStart: 100,
      rangeEnd: 0,
    );

    test('drops non-finite values but keeps x slots aligned', () {
      final p = projectSeries(
        [1, double.nan, 3],
        n: 3,
        left: 0,
        right: 100,
        yScale: scale,
        maxPoints: 50,
      );
      expect(p.idx, [0, 2]);
      expect(p.xs, [0, 100]);
      expect(p.ys, [90, 70]);
    });

    test('a single point sits in the middle of the axis', () {
      final p = projectSeries(
        [5],
        n: 1,
        left: 10,
        right: 110,
        yScale: scale,
        maxPoints: 50,
      );
      expect(p.xs, [60]);
    });

    test('long series are decimated', () {
      final v = [for (var i = 0; i < 2000; i++) (i % 10).toDouble()];
      final p = projectSeries(
        v,
        n: 2000,
        left: 0,
        right: 300,
        yScale: scale,
        maxPoints: 200,
      );
      expect(p.length, lessThanOrEqualTo(200));
      expect(p.xs.first, 0);
      expect(p.xs.last, 300);
    });
  });

  group('lerpPolyline', () {
    const a = Polyline([0, 1], [0, 100], [10, 10]);
    const b = Polyline([0, 1], [0, 100], [50, 90]);

    test('endpoints return the inputs', () {
      expect(lerpPolyline(a, b, 0), same(a));
      expect(lerpPolyline(a, b, 1), same(b));
    });

    test('midpoint averages matching shapes', () {
      final m = lerpPolyline(a, b, 0.5);
      expect(m.ys.first, closeTo(30, 1e-9));
      expect(m.ys.last, closeTo(50, 1e-9));
      expect(m.xs.first, 0);
      expect(m.xs.last, 100);
    });

    test('different point counts still blend', () {
      const c = Polyline([0, 1, 2], [0, 50, 100], [0, 100, 0]);
      final m = lerpPolyline(a, c, 0.5);
      // At x = 50 the first is flat 10 and the second peaks at 100.
      final mid = m.length ~/ 2;
      expect(m.ys[mid], closeTo(55, 5));
    });
  });

  group('misc', () {
    test('nearestIndex snaps to the closest available index', () {
      expect(nearestIndex([0, 4, 9], 5), 4);
      expect(nearestIndex([0, 4, 9], 7), 9);
      expect(nearestIndex([3], 100), 3);
      expect(nearestIndex([2, 6], 4), 2); // ties go left
    });

    test('simpleMovingAverage leaves NaN until the window fills', () {
      final out = simpleMovingAverage([1, 2, 3, 4, 5], 3);
      expect(out[0].isNaN, isTrue);
      expect(out[1].isNaN, isTrue);
      expect(out.sublist(2), [2, 3, 4]);
    });

    test('decimalsForStep', () {
      expect(decimalsForStep(25), 0);
      expect(decimalsForStep(0.25), 2);
      expect(decimalsForStep(0.5), 1);
    });
  });

  group('formatting', () {
    test('formatChartNumber', () {
      expect(formatChartNumber(1234.5), '1,235');
      expect(formatChartNumber(12.5), '12.5');
      expect(formatChartNumber(69), '69');
      expect(formatChartNumber(0.25), '0.25');
      expect(formatChartNumber(0.5, fractionDigits: 2), '0.50');
      expect(formatChartNumber(15300), '15.3K');
      expect(formatChartNumber(250000), '250K');
      expect(formatChartNumber(4200000), '4.2M');
      expect(formatChartNumber(-3.5, fractionDigits: 1), '\u22123.5');
      expect(formatChartNumber(-0.0001, fractionDigits: 1), '0.0');
      expect(formatChartNumber(double.nan), '\u2014');
    });

    test('formatChange', () {
      expect(formatChange(100, 112.34), '+12.3%');
      expect(formatChange(100, 90), '\u221210.0%');
      expect(formatChange(0, 5), isNull);
    });

    test('summarizeSeries covers start, end, change and extremes', () {
      final s = summarizeSeries([100, 90, 120], name: 'Equity');
      expect(s, contains('Equity'));
      expect(s, contains('from 100 to 120'));
      expect(s, contains('+20.0%'));
      expect(s, contains('low 90'));
      expect(s, contains('high 120'));
      expect(summarizeSeries([], name: 'Equity'), 'Equity, no data');
      expect(summarizeSeries([double.nan, 7], name: 'X'), 'X, one point at 7');
    });
  });
}

void _expectNoOverlap(
  List<int> idx,
  int n,
  double plot,
  double Function(int) w,
) {
  double? end;
  for (var j = 0; j < idx.length; j++) {
    final width = w(idx[j]);
    final x = idx[j] / (n - 1) * plot;
    final start = j == 0
        ? 0.0
        : j == idx.length - 1
        ? plot - width
        : x - width / 2;
    if (end != null) {
      expect(start, greaterThanOrEqualTo(end), reason: 'labels $idx overlap');
    }
    end = start + width;
  }
}
