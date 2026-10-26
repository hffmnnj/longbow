@Tags(['charts'])
library;

import 'dart:typed_data';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/charts/chart_math.dart';
import 'package:longbow/core/charts/dither.dart';

Polyline flat(double y, double x0, double x1) =>
    Polyline(const [0, 1], [x0, x1], [y, y]);

List<(double, double, int)> cells(DitherMask m) => [
  for (var t = 0; t < kDitherTiers; t++)
    for (var i = 0; i < m.tiers[t].length; i += 2)
      (m.tiers[t][i], m.tiers[t][i + 1], t + 1),
];

void main() {
  group('Bayer matrix', () {
    test('is the 4x4 ordered matrix (v + 0.5) / 16, each value once', () {
      final scaled = kBayer4.map((v) => v * 16 - 0.5).toList();
      expect(scaled.map((v) => v.round()).toSet(), {
        for (var i = 0; i < 16; i++) i,
      });
      for (final v in scaled) {
        expect(v, closeTo(v.roundToDouble(), 1e-9));
      }
      // Rows from the web dither-kit: [0 8 2 10], [12 4 14 6], [3 11 1 9], [15 7 13 5].
      expect(
        [
          for (var x = 0; x < 4; x++)
            (ditherThreshold(x, 0) * 16 - 0.5).round(),
        ],
        [0, 8, 2, 10],
      );
      expect(
        [
          for (var x = 0; x < 4; x++)
            (ditherThreshold(x, 3) * 16 - 0.5).round(),
        ],
        [15, 7, 13, 5],
      );
    });

    test('tiles with period 4 in both axes, also for negative cells', () {
      for (var gx = -9; gx < 9; gx++) {
        for (var gy = -9; gy < 9; gy++) {
          expect(ditherThreshold(gx, gy), ditherThreshold(gx + 4, gy + 4));
        }
      }
    });
  });

  group('ditherCellAlpha', () {
    test('the baseline is fully lit, the value line is faint', () {
      expect(ditherCellAlpha(gx: 0, gy: 0, depth: 1), closeTo(1, 1e-9));
      // depth 0: never lit, so floor 0.3 * off tier 0.4.
      expect(ditherCellAlpha(gx: 3, gy: 2, depth: 0), closeTo(0.12, 1e-9));
    });

    test('a cell lights exactly when depth passes its Bayer threshold', () {
      final thr = ditherThreshold(1, 0); // 8.5/16
      final below = ditherCellAlpha(gx: 1, gy: 0, depth: thr - 0.01);
      final above = ditherCellAlpha(gx: 1, gy: 0, depth: thr + 0.01);
      expect(above / below, greaterThan(2)); // lit is 2.5x the unlit tier
    });

    test('maxAlpha scales and depth is clamped', () {
      expect(
        ditherCellAlpha(gx: 0, gy: 0, depth: 5, maxAlpha: 0.5),
        closeTo(0.5, 1e-9),
      );
      expect(
        ditherCellAlpha(gx: 0, gy: 0, depth: -3),
        closeTo(0.3 * 0.4, 1e-9),
      );
    });
  });

  group('ditherCellSize', () {
    test('is a whole number of physical pixels at every density', () {
      for (final dpr in [1.0, 1.5, 2.0, 2.625, 2.75, 3.0, 3.5, 4.0]) {
        final cell = ditherCellSize(dpr);
        expect(
          cell * dpr,
          closeTo((cell * dpr).roundToDouble(), 1e-9),
          reason: '$dpr',
        );
        expect(cell, inInclusiveRange(1.5, 2.7), reason: '$dpr');
      }
    });

    test('bad density falls back to 1', () {
      expect(ditherCellSize(0), 2);
    });
  });

  group('buildDitherMask', () {
    const plot = Rect.fromLTRB(0, 0, 100, 60);
    const cell = 2.0;

    test('is deterministic: same inputs give identical cells', () {
      final a = buildDitherMask(plot: plot, cell: cell, line: flat(20, 0, 100));
      final b = buildDitherMask(plot: plot, cell: cell, line: flat(20, 0, 100));
      expect(a.cellCount, greaterThan(0));
      for (var t = 0; t < kDitherTiers; t++) {
        expect(a.tiers[t], orderedEquals(b.tiers[t]));
      }
    });

    test('cell centers sit on the canvas grid', () {
      final m = buildDitherMask(plot: plot, cell: 2.2, line: flat(20.3, 3, 90));
      for (final (x, y, _) in cells(m)) {
        expect(x / 2.2 - 0.5, closeTo((x / 2.2 - 0.5).roundToDouble(), 1e-4));
        expect(y / 2.2 - 0.5, closeTo((y / 2.2 - 0.5).roundToDouble(), 1e-4));
      }
    });

    test('only fills below the line, inside the plot and the line extent', () {
      final m = buildDitherMask(plot: plot, cell: cell, line: flat(20, 10, 70));
      for (final (x, y, _) in cells(m)) {
        expect(y, greaterThanOrEqualTo(20));
        expect(y, lessThanOrEqualTo(60));
        expect(x, inInclusiveRange(10, 70));
      }
    });

    test('data elsewhere does not move existing cells (no shimmer)', () {
      final narrow = buildDitherMask(
        plot: plot,
        cell: cell,
        line: flat(20, 0, 50),
      );
      final wide = buildDitherMask(
        plot: plot,
        cell: cell,
        line: flat(20, 0, 100),
      );
      final keep = cells(wide).where((c) => c.$1 <= 50).toSet();
      expect(cells(narrow).toSet(), keep);
    });

    test('is denser and brighter toward the baseline', () {
      final m = buildDitherMask(plot: plot, cell: cell, line: flat(0, 0, 100));
      double weight(double y0, double y1) {
        var sum = 0.0;
        var count = 0;
        for (final (_, y, tier) in cells(m)) {
          if (y >= y0 && y < y1) {
            sum += tier / kDitherTiers;
            count++;
          }
        }
        return sum / count;
      }

      final top = weight(0, 20);
      final mid = weight(20, 40);
      final bottom = weight(40, 60);
      expect(top, lessThan(mid));
      expect(mid, lessThan(bottom));
      expect(top, lessThan(0.25));
      expect(bottom, greaterThan(0.55));
    });

    test('a sloped line starts each column at its own height', () {
      const slope = Polyline([0, 1], [0, 100], [50, 10]);
      final m = buildDitherMask(plot: plot, cell: cell, line: slope);
      double minY(double x) =>
          cells(m)
              .where((c) => c.$1 == x)
              .map((c) => c.$2)
              .reduce((a, b) => a < b ? a : b);
      // Column centers 1.0 (near the left, line at ~49.6) and 99.0 (line ~10.4).
      expect(minY(1), closeTo(49.6, 2));
      expect(minY(99), closeTo(10.4, 2));
    });

    test('empty, single point and degenerate plots give an empty mask', () {
      expect(
        buildDitherMask(plot: plot, cell: cell, line: Polyline.empty).cellCount,
        0,
      );
      expect(
        buildDitherMask(
          plot: plot,
          cell: cell,
          line: const Polyline([0], [5], [5]),
        ).cellCount,
        0,
      );
      expect(
        buildDitherMask(
          plot: Rect.zero,
          cell: cell,
          line: flat(0, 0, 10),
        ).cellCount,
        0,
      );
      expect(
        buildDitherMask(plot: plot, cell: 0, line: flat(0, 0, 10)).cellCount,
        0,
      );
    });

    test('a line on the baseline leaves nothing to fill', () {
      expect(
        buildDitherMask(
          plot: plot,
          cell: cell,
          line: flat(60, 0, 100),
        ).cellCount,
        0,
      );
    });

    test('tier buffers hold x,y pairs', () {
      final m = buildDitherMask(plot: plot, cell: cell, line: flat(10, 0, 100));
      for (final t in m.tiers) {
        expect(t, isA<Float32List>());
        expect(t.length.isEven, isTrue);
      }
    });
  });

  group('bars', () {
    test('a vertical bar is brightest at its base, sparse at the tip', () {
      final b = DitherMaskBuilder(2)
        ..addVerticalBar(
          const Rect.fromLTWH(0, 0, 40, 40),
          tipAtTop: true,
          maxAlpha: 1,
        );
      final m = b.build();
      double avg(double y0, double y1) {
        final c = cells(m).where((e) => e.$2 >= y0 && e.$2 < y1).toList();
        return c.fold(0.0, (s, e) => s + e.$3) / c.length;
      }

      expect(avg(0, 10), lessThan(avg(30, 40)));
    });

    test('a negative bar mirrors: tip at the bottom', () {
      final m =
          (DitherMaskBuilder(2)..addVerticalBar(
                const Rect.fromLTWH(0, 0, 40, 40),
                tipAtTop: false,
                maxAlpha: 1,
              ))
              .build();
      double avg(double y0, double y1) {
        final c = cells(m).where((e) => e.$2 >= y0 && e.$2 < y1).toList();
        return c.fold(0.0, (s, e) => s + e.$3) / c.length;
      }

      expect(avg(30, 40), lessThan(avg(0, 10)));
    });

    test('empty rects add nothing', () {
      final b = DitherMaskBuilder(2)
        ..addVerticalBar(Rect.zero, tipAtTop: true)
        ..addHorizontalBar(const Rect.fromLTWH(0, 0, 0, 10), tipAtRight: true);
      expect(b.build().cellCount, 0);
    });
  });
}
