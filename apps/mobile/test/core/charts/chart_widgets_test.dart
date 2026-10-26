@Tags(['charts'])
library;

import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/charts/cartesian_chart.dart'
    show CartesianChartCore;
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/theme/tokens.dart';

Widget harness(
  Widget child, {
  double width = 320,
  double? height,
  double textScale = 1,
  bool disableAnimations = false,
  bool light = false,
}) {
  return MaterialApp(
    theme: ThemeData(
      brightness: light ? Brightness.light : Brightness.dark,
      extensions: [light ? LongbowColors.light : LongbowColors.dark],
    ),
    builder: (context, app) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: TextScaler.linear(textScale),
        disableAnimations: disableAnimations,
      ),
      child: app!,
    ),
    home: Scaffold(
      body: Align(
        alignment: Alignment.topLeft,
        child: SizedBox(width: width, height: height, child: child),
      ),
    ),
  );
}

/// The data layer render object of a chart (first CustomPaint below it).
RenderObject dataLayer(WidgetTester t, Finder chart) => t.renderObject(
  find.descendant(of: chart, matching: find.byType(CustomPaint)).first,
);

List<double> ramp(int n, {double start = 100, double step = 1}) => [
  for (var i = 0; i < n; i++) start + i * step,
];

bool rawPoints(Symbol name, List<dynamic> args) => name == #drawRawPoints;

class FakeHaptics extends ScrubHaptics {
  FakeHaptics(this.log, {required this.advance});
  final List<DateTime> log;
  final Duration advance;
  DateTime _clock = DateTime(2026);

  @override
  bool indexChanged() {
    _clock = _clock.add(advance);
    final last = log.isEmpty ? null : log.last;
    if (last != null && _clock.difference(last) < minInterval) return false;
    log.add(_clock);
    return true;
  }
}

void main() {
  group('ScrubHaptics', () {
    test('fires on a change, then waits 40 ms before the next', () {
      var now = DateTime(2026);
      var fired = 0;
      final h = ScrubHaptics(now: () => now, fire: () => fired++);
      expect(h.indexChanged(), isTrue);
      now = now.add(const Duration(milliseconds: 39));
      expect(h.indexChanged(), isFalse);
      now = now.add(const Duration(milliseconds: 1));
      expect(h.indexChanged(), isTrue);
      expect(fired, 2);
    });
  });

  group('DitherAreaChart', () {
    testWidgets('draws grid, dither fill, then the line; axes read in mono', (
      t,
    ) async {
      await t.pumpWidget(
        harness(
          DitherAreaChart(
            values: ramp(30),
            labels: [for (var i = 0; i < 30; i++) 'D$i'],
          ),
        ),
      );
      await t.pumpAndSettle();
      final chart = find.byType(DitherAreaChart);
      expect(
        dataLayer(t, chart),
        paints
          ..something(rawPoints)
          ..path(),
      );
      expect(t.takeException(), isNull);
    });

    for (final c in <String, List<double>>{
      'empty': [],
      'one point': [5],
      'all equal': [3, 3, 3, 3, 3],
      'all zero': [0, 0, 0],
      'negative with zero crossing': [-4, -1, 0, 2, -3, 5],
      'all negative': [-9, -8, -12, -3],
      'NaN and infinity mixed in': [
        1,
        double.nan,
        3,
        double.infinity,
        2,
        double.negativeInfinity,
        5,
      ],
      'only NaN': [double.nan, double.nan],
      '2000 points': [
        for (var i = 0; i < 2000; i++) math.sin(i / 20) * 50 + i * 0.05,
      ],
      'huge magnitudes': [1e12, 3e12, 2e12],
      'tiny magnitudes': [1e-9, 3e-9, 2e-9],
    }.entries) {
      testWidgets('survives ${c.key}', (t) async {
        await t.pumpWidget(
          harness(
            DitherAreaChart(
              values: c.value,
              benchmark: c.value.isEmpty ? null : c.value.reversed.toList(),
              referenceLines: const [
                ChartReferenceLine(value: 2, label: 'Stop'),
              ],
              markers: const [
                ChartMarker(index: 1, kind: ChartMarkerKind.buy),
                ChartMarker(index: 99, kind: ChartMarkerKind.sell),
              ],
            ),
          ),
        );
        await t.pumpAndSettle();
        expect(t.takeException(), isNull);
        expect(find.byType(DitherAreaChart), findsOneWidget);
      });
    }

    testWidgets('empty series draws only the baseline, no line or fill', (
      t,
    ) async {
      await t.pumpWidget(harness(const DitherAreaChart(values: [])));
      await t.pumpAndSettle();
      final r = dataLayer(t, find.byType(DitherAreaChart));
      expect(r, paints..line());
      expect(r, isNot(paints..path()));
      expect(r, isNot(paints..something(rawPoints)));
    });

    testWidgets('a single point draws a dot, not a line', (t) async {
      await t.pumpWidget(harness(const DitherAreaChart(values: [7])));
      await t.pumpAndSettle();
      final r = dataLayer(t, find.byType(DitherAreaChart));
      expect(r, paints..circle());
      expect(r, isNot(paints..path()));
    });

    testWidgets(
      'zero width or zero height renders nothing and does not throw',
      (t) async {
        await t.pumpWidget(harness(DitherAreaChart(values: ramp(5)), width: 0));
        expect(t.takeException(), isNull);
        expect(
          find
              .byType(CustomPaint)
              .evaluate()
              .where(
                (e) =>
                    e.widget is CustomPaint &&
                    (e.renderObject as RenderBox).size.isEmpty,
              ),
          isEmpty,
        );
        await t.pumpWidget(
          harness(DitherAreaChart(values: ramp(5), height: 0)),
        );
        expect(t.takeException(), isNull);
      },
    );

    testWidgets('semantics summarise start, end and change', (t) async {
      final h = t.ensureSemantics();
      await t.pumpWidget(harness(DitherAreaChart(values: [100, 90, 120])));
      await t.pumpAndSettle();
      expect(
        find.bySemanticsLabel(RegExp(r'from 100 to 120.*\+20\.0%')),
        findsOneWidget,
      );
      h.dispose();
    });

    testWidgets(
      'an explicit semanticsLabel replaces the default and counts markers',
      (t) async {
        final h = t.ensureSemantics();
        await t.pumpWidget(
          harness(
            const DitherAreaChart(
              values: [1, 2],
              semanticsLabel: 'Equity this month',
            ),
          ),
        );
        expect(find.bySemanticsLabel('Equity this month'), findsOneWidget);
        await t.pumpWidget(
          harness(
            DitherAreaChart(
              values: ramp(5),
              markers: const [
                ChartMarker(index: 1, kind: ChartMarkerKind.buy),
                ChartMarker(index: 3, kind: ChartMarkerKind.sell),
              ],
            ),
          ),
        );
        expect(find.bySemanticsLabel(RegExp(r'1 buy, 1 sell')), findsOneWidget);
        h.dispose();
      },
    );

    testWidgets(
      'animates in on first draw and settles; no frames are scheduled once settled',
      (t) async {
        await t.pumpWidget(harness(DitherAreaChart(values: ramp(10))));
        expect(t.binding.hasScheduledFrame, isTrue);
        await t.pump(const Duration(milliseconds: 200));
        expect(t.binding.hasScheduledFrame, isTrue);
        await t.pump(const Duration(milliseconds: 250));
        await t.pump();
        expect(t.binding.hasScheduledFrame, isFalse);
      },
    );

    testWidgets(
      'reduced motion skips every animation, including data changes',
      (t) async {
        await t.pumpWidget(
          harness(DitherAreaChart(values: ramp(10)), disableAnimations: true),
        );
        await t.pump();
        expect(t.binding.hasScheduledFrame, isFalse);
        await t.pumpWidget(
          harness(
            DitherAreaChart(values: ramp(10, start: 50)),
            disableAnimations: true,
          ),
        );
        await t.pump();
        expect(t.binding.hasScheduledFrame, isFalse);
      },
    );

    testWidgets(
      'new data morphs for about 250 ms then settles on the new series',
      (t) async {
        final h = t.ensureSemantics();
        await t.pumpWidget(harness(DitherAreaChart(values: [100, 110])));
        await t.pumpAndSettle();
        await t.pumpWidget(harness(DitherAreaChart(values: [100, 130])));
        await t.pump(const Duration(milliseconds: 100));
        expect(t.binding.hasScheduledFrame, isTrue);
        await t.pump(const Duration(milliseconds: 200));
        await t.pump();
        expect(t.binding.hasScheduledFrame, isFalse);
        expect(find.bySemanticsLabel(RegExp(r'to 130')), findsOneWidget);
        expect(t.takeException(), isNull);
        h.dispose();
      },
    );

    testWidgets('equal data in a fresh list does not restart the morph', (
      t,
    ) async {
      await t.pumpWidget(harness(DitherAreaChart(values: [1, 2, 3])));
      await t.pumpAndSettle();
      await t.pumpWidget(harness(DitherAreaChart(values: [1, 2, 3])));
      await t.pump();
      expect(t.binding.hasScheduledFrame, isFalse);
    });

    testWidgets('large text and a narrow box still lay out', (t) async {
      await t.pumpWidget(
        harness(
          DitherAreaChart(
            values: ramp(20),
            labels: [for (var i = 0; i < 20; i++) '2026-01-${i + 1}'],
          ),
          width: 150,
          textScale: 2,
        ),
      );
      await t.pumpAndSettle();
      expect(t.takeException(), isNull);
    });

    testWidgets('light theme paints too', (t) async {
      await t.pumpWidget(
        harness(DitherAreaChart(values: ramp(8)), light: true),
      );
      await t.pumpAndSettle();
      expect(
        dataLayer(t, find.byType(DitherAreaChart)),
        paints
          ..something(rawPoints)
          ..path(),
      );
    });
  });

  group('scrubbing', () {
    Future<List<int?>> dragAcross(
      WidgetTester t,
      Finder chart, {
      double from = 3,
      double to = 297,
      int steps = 20,
      double dy = 0,
    }) async {
      final origin = t.getTopLeft(chart);
      final g = await t.startGesture(origin + Offset(from, 100));
      for (var i = 1; i <= steps; i++) {
        await g.moveTo(
          origin + Offset(from + (to - from) * i / steps, 100 + dy * i / steps),
        );
        await t.pump(const Duration(milliseconds: 16));
      }
      await g.up();
      await t.pump();
      return const [];
    }

    testWidgets('horizontal drag reports ascending indexes, ends with null', (
      t,
    ) async {
      final events = <int?>[];
      await t.pumpWidget(
        harness(
          DitherAreaChart(
            values: ramp(20),
            labels: [for (var i = 0; i < 20; i++) 'day-$i'],
            onScrub: events.add,
            enableHaptics: false,
            animate: false,
          ),
          height: 200,
        ),
      );
      await dragAcross(t, find.byType(DitherAreaChart));
      expect(events.last, isNull);
      final live = events.whereType<int>().toList();
      expect(live.first, 0);
      expect(live.last, 19);
      expect(live, orderedEquals([...live]..sort()));
      expect(live.toSet().length, greaterThan(8));
      expect(events.sublist(0, events.length - 1).contains(null), isFalse);
    });

    testWidgets('maps x to the nearest point (plot spans 2..318 without axes)',
        (t) async {
      final events = <int?>[];
      await t.pumpWidget(harness(
        DitherAreaChart(
          values: ramp(11),
          showAxes: false,
          onScrub: events.add,
          enableHaptics: false,
          animate: false,
        ),
        height: 200,
      ));
      final origin = t.getTopLeft(find.byType(DitherAreaChart));
      final g = await t.startGesture(origin + const Offset(150, 100));
      await g.moveTo(origin + const Offset(185.3, 100)); // 58% across: slot 5.8
      await t.pump();
      expect(events.whereType<int>().last, 6);
      await g.moveTo(origin + const Offset(137.9, 100)); // 43% across: slot 4.3
      await t.pump();
      expect(events.whereType<int>().last, 4);
      await g.up();
    });

    testWidgets(
      'a readout bubble appears while scrubbing and disappears on release',
      (t) async {
        await t.pumpWidget(
          harness(
            DitherAreaChart(
              values: ramp(20, start: 1000),
              labels: [for (var i = 0; i < 20; i++) 'day-$i'],
              enableHaptics: false,
              animate: false,
            ),
            height: 200,
          ),
        );
        final origin = t.getTopLeft(find.byType(DitherAreaChart));
        final g = await t.startGesture(origin + const Offset(3, 100));
        await g.moveTo(origin + const Offset(300, 100));
        await t.pump();
        expect(find.text('day-19'), findsOneWidget);
        expect(find.text('1,019'), findsOneWidget);
        await g.up();
        await t.pump();
        expect(find.text('day-19'), findsNothing);
      },
    );

    testWidgets('showReadout false keeps the callback but hides the bubble', (
      t,
    ) async {
      final events = <int?>[];
      await t.pumpWidget(
        harness(
          DitherAreaChart(
            values: ramp(20),
            labels: [for (var i = 0; i < 20; i++) 'day-$i'],
            showReadout: false,
            onScrub: events.add,
            enableHaptics: false,
            animate: false,
          ),
          height: 200,
        ),
      );
      final origin = t.getTopLeft(find.byType(DitherAreaChart));
      final g = await t.startGesture(origin + const Offset(3, 100));
      await g.moveTo(origin + const Offset(300, 100));
      await t.pump();
      expect(find.text('day-19'), findsNothing);
      expect(events.whereType<int>(), isNotEmpty);
      await g.up();
    });

    testWidgets('scrub snaps past NaN gaps to a real point', (t) async {
      final events = <int?>[];
      await t.pumpWidget(
        harness(
          DitherAreaChart(
            values: [
              1,
              2,
              double.nan,
              double.nan,
              double.nan,
              double.nan,
              7,
              8,
            ],
            onScrub: events.add,
            enableHaptics: false,
            animate: false,
          ),
          height: 200,
        ),
      );
      await dragAcross(t, find.byType(DitherAreaChart), steps: 40);
      for (final i in events.whereType<int>()) {
        expect([0, 1, 6, 7], contains(i));
      }
    });

    testWidgets(
      'a vertical swipe over the chart scrolls the parent and never scrubs',
      (t) async {
        final events = <int?>[];
        final controller = ScrollController();
        await t.pumpWidget(
          MaterialApp(
            theme: ThemeData(extensions: [LongbowColors.dark]),
            home: Scaffold(
              body: ListView(
                controller: controller,
                children: [
                  DitherAreaChart(
                    values: ramp(20),
                    onScrub: events.add,
                    enableHaptics: false,
                    animate: false,
                  ),
                  const SizedBox(height: 1500),
                ],
              ),
            ),
          ),
        );
        await t.dragFrom(const Offset(160, 120), const Offset(0, -150));
        await t.pump();
        expect(controller.offset, greaterThan(100));
        expect(events, isEmpty);
      },
    );

    testWidgets(
      'long-press mode ignores a plain drag, scrubs after the press',
      (t) async {
        final events = <int?>[];
        await t.pumpWidget(
          harness(
            DitherAreaChart(
              values: ramp(20),
              scrubMode: ChartScrubMode.longPress,
              onScrub: events.add,
              enableHaptics: false,
              animate: false,
            ),
            height: 200,
          ),
        );
        final origin = t.getTopLeft(find.byType(DitherAreaChart));
        var g = await t.startGesture(origin + const Offset(3, 100));
        await g.moveTo(origin + const Offset(200, 100));
        await g.up();
        await t.pump();
        expect(events, isEmpty);

        g = await t.startGesture(origin + const Offset(3, 100));
        await t.pump(kLongPressTimeout + const Duration(milliseconds: 50));
        await g.moveTo(origin + const Offset(300, 100));
        await t.pump();
        expect(events.whereType<int>().last, 19);
        await g.up();
        await t.pump();
        expect(events.last, isNull);
      },
    );

    testWidgets(
      'haptics fire when the point changes, never for the first point',
      (t) async {
        final log = <DateTime>[];
        final events = <int?>[];
        await t.pumpWidget(
          harness(
            ColumnChart(
              categories: [for (var i = 0; i < 10; i++) 'c$i'],
              series: [ColumnSeries(values: ramp(10, start: 1))],
              onScrub: events.add,
              animate: false,
              hapticsOverride: FakeHaptics(
                log,
                advance: const Duration(milliseconds: 50),
              ),
            ),
            height: 200,
          ),
        );
        await dragAcross(t, find.byType(ColumnChart));
        final distinct = events.whereType<int>().toSet().length;
        expect(distinct, 10);
        expect(log.length, distinct - 1);
      },
    );

    testWidgets(
      'haptics are throttled to one per 40 ms even when the index races',
      (t) async {
        final log = <DateTime>[];
        await t.pumpWidget(
          harness(
            ColumnChart(
              categories: [for (var i = 0; i < 10; i++) 'c$i'],
              series: [ColumnSeries(values: ramp(10, start: 1))],
              animate: false,
              hapticsOverride: FakeHaptics(
                log,
                advance: const Duration(milliseconds: 10),
              ),
            ),
            height: 200,
          ),
        );
        await dragAcross(t, find.byType(ColumnChart));
        // 9 changes, 10 ms apart: only every fourth may fire.
        expect(log.length, inInclusiveRange(2, 3));
        for (var i = 1; i < log.length; i++) {
          expect(
            log[i].difference(log[i - 1]),
            greaterThanOrEqualTo(const Duration(milliseconds: 40)),
          );
        }
      },
    );
  });

  group('Sparkline', () {
    testWidgets('paints a line over a dither fill at the requested size', (
      t,
    ) async {
      await t.pumpWidget(
        harness(
          Align(
            alignment: Alignment.topLeft,
            child: Sparkline(values: ramp(30)),
          ),
          width: 200,
        ),
      );
      expect(t.getSize(find.byType(Sparkline)), const Size(64, 24));
      expect(
        dataLayer(t, find.byType(Sparkline)),
        paints
          ..something(rawPoints)
          ..path(),
      );
    });

    testWidgets('dashed benchmark adds a second path', (t) async {
      await t.pumpWidget(
        harness(
          Sparkline(
            values: ramp(30),
            benchmark: ramp(30, start: 105, step: 0.5),
          ),
        ),
      );
      expect(
        dataLayer(t, find.byType(Sparkline)),
        paints
          ..path()
          ..path(),
      );
    });

    for (final c in <String, List<double>>{
      'empty': [],
      'one point': [4],
      'flat': [2, 2, 2],
      'NaN': [double.nan, double.nan, 1],
      'negative': [-3, -1, -2],
      '2000 points': [for (var i = 0; i < 2000; i++) (i % 17).toDouble()],
    }.entries) {
      testWidgets('survives ${c.key}', (t) async {
        await t.pumpWidget(harness(Sparkline(values: c.value)));
        expect(t.takeException(), isNull);
      });
    }

    testWidgets('fewer than two points draw a dashed placeholder, not a fill', (
      t,
    ) async {
      await t.pumpWidget(harness(const Sparkline(values: [4])));
      final r = dataLayer(t, find.byType(Sparkline));
      expect(r, paints..line());
      expect(r, isNot(paints..something(rawPoints)));
    });

    testWidgets('is a single repaint boundary child with a spoken trend', (
      t,
    ) async {
      final h = t.ensureSemantics();
      await t.pumpWidget(harness(Sparkline(values: [10, 12, 15])));
      expect(
        find.bySemanticsLabel(RegExp(r'from 10 to 15.*\+50\.0%')),
        findsOneWidget,
      );
      h.dispose();
    });

    testWidgets('zero size does not throw', (t) async {
      await t.pumpWidget(
        harness(Sparkline(values: ramp(5), width: 0, height: 0)),
      );
      expect(t.takeException(), isNull);
    });
  });

  group('MultiLineChart', () {
    testWidgets('legend lists each named line and the chart draws every line', (
      t,
    ) async {
      await t.pumpWidget(
        harness(
          MultiLineChart(
            lines: [
              ChartLine(name: 'Run A', values: ramp(20, start: 100, step: 1)),
              ChartLine(
                name: 'Run B',
                values: ramp(15, start: 100, step: -0.5),
              ),
              ChartLine(
                name: 'SPY',
                values: ramp(20, start: 100, step: 0.3),
                dashed: true,
              ),
            ],
            referenceLines: const [ChartReferenceLine(value: 100)],
          ),
          height: 320,
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Run A'), findsOneWidget);
      expect(find.text('Run B'), findsOneWidget);
      expect(find.text('SPY'), findsOneWidget);
      expect(
        dataLayer(t, find.byType(CartesianChartCore)),
        paints
          ..path()
          ..path()
          ..path(),
      );
    });

    testWidgets('scrub readout names each series and reports one index', (
      t,
    ) async {
      final events = <int?>[];
      await t.pumpWidget(
        harness(
          MultiLineChart(
            lines: [
              ChartLine(name: 'Run A', values: ramp(20)),
              ChartLine(name: 'Run B', values: ramp(20, start: 50)),
            ],
            onScrub: events.add,
            enableHaptics: false,
            animate: false,
          ),
          height: 320,
        ),
      );
      final origin = t.getTopLeft(find.byType(CartesianChartCore));
      final g = await t.startGesture(origin + const Offset(3, 100));
      await g.moveTo(origin + const Offset(300, 100));
      await t.pump();
      expect(find.text('119'), findsOneWidget);
      expect(find.text('69'), findsOneWidget);
      await g.up();
      expect(events.whereType<int>().last, 19);
    });

    for (final lines in <String, List<ChartLine>>{
      'no lines': [],
      'empty line': [const ChartLine(name: 'x', values: [])],
      'mixed lengths with NaN': [
        const ChartLine(name: 'a', values: [1, double.nan, 3]),
        ChartLine(name: 'b', values: ramp(2000)),
      ],
    }.entries) {
      testWidgets('survives ${lines.key}', (t) async {
        await t.pumpWidget(harness(MultiLineChart(lines: lines.value)));
        await t.pumpAndSettle();
        expect(t.takeException(), isNull);
      });
    }
  });

  group('CurveChart', () {
    testWidgets('scrub snaps to categories and shows the full name', (t) async {
      final events = <int?>[];
      const tenors = ['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y', '30Y'];
      await t.pumpWidget(
        harness(
          CurveChart(
            labels: tenors,
            values: const [5.3, 5.4, 5.2, 4.9, 4.6, 4.3, 4.4, 4.6],
            onScrub: events.add,
            enableHaptics: false,
            animate: false,
            valueFormatter: (v) => '${v.toStringAsFixed(2)}%',
          ),
          height: 200,
        ),
      );
      final origin = t.getTopLeft(find.byType(CurveChart));
      final g = await t.startGesture(origin + const Offset(3, 100));
      await g.moveTo(origin + const Offset(400, 100));
      await t.pump();
      expect(events.whereType<int>().last, 7);
      expect(find.text('30Y'), findsOneWidget);
      expect(find.text('4.60%'), findsOneWidget);
      await g.up();
    });

    testWidgets('draws dots on every point', (t) async {
      await t.pumpWidget(
        harness(const CurveChart(labels: ['a', 'b', 'c'], values: [1, 3, 2])),
      );
      await t.pumpAndSettle();
      expect(
        dataLayer(t, find.byType(CurveChart)),
        paints
          ..path()
          ..circle()
          ..circle()
          ..circle(),
      );
    });

    testWidgets('mismatched or empty inputs do not throw', (t) async {
      await t.pumpWidget(
        harness(const CurveChart(labels: ['a'], values: [1, 2, 3])),
      );
      await t.pumpAndSettle();
      await t.pumpWidget(harness(const CurveChart(labels: [], values: [])));
      await t.pumpAndSettle();
      expect(t.takeException(), isNull);
    });
  });

  group('BarStrip and BarStripList', () {
    test('barFraction clamps and rejects junk', () {
      expect(barFraction(25, 100), 0.25);
      expect(barFraction(150, 100), 1);
      expect(barFraction(-5, 100), 0);
      expect(barFraction(5, 0), 0);
      expect(barFraction(double.nan, 100), 0);
      expect(barFraction(5, double.infinity), 0);
    });

    testWidgets(
      'paints the track, the solid body, the dither tail and the marker',
      (t) async {
        await t.pumpWidget(
          harness(
            const BarStrip(
              value: 60,
              marker: 50,
              semanticsLabel: 'Breadth 60%',
              animate: false,
            ),
          ),
        );
        expect(t.getSize(find.byType(BarStrip)).height, 10);
        expect(
          dataLayer(t, find.byType(BarStrip)),
          paints
            ..rrect()
            ..rect()
            ..something(rawPoints)
            ..rect(),
        );
      },
    );

    testWidgets('has a spoken label', (t) async {
      final h = t.ensureSemantics();
      await t.pumpWidget(
        harness(const BarStrip(value: 3, semanticsLabel: 'AAPL 3% of equity')),
      );
      expect(find.bySemanticsLabel('AAPL 3% of equity'), findsOneWidget);
      h.dispose();
    });

    testWidgets('zero, over-range and NaN values do not throw', (t) async {
      for (final v in <double>[0, 1e9, double.nan, -4]) {
        await t.pumpWidget(
          harness(BarStrip(value: v, semanticsLabel: 'x', animate: false)),
        );
        expect(t.takeException(), isNull);
      }
    });

    testWidgets('a changed value glides, then settles', (t) async {
      await t.pumpWidget(
        harness(const BarStrip(value: 10, semanticsLabel: 'x')),
      );
      await t.pumpAndSettle();
      await t.pumpWidget(
        harness(const BarStrip(value: 80, semanticsLabel: 'x')),
      );
      await t.pump(const Duration(milliseconds: 100));
      expect(t.binding.hasScheduledFrame, isTrue);
      await t.pumpAndSettle();
    });

    testWidgets(
      'list shows labels and values, scales with text, and tolerates empties',
      (t) async {
        await t.pumpWidget(
          harness(
            const BarStripList(
              rows: [
                BarRow(
                  label: 'Technology',
                  value: 42,
                  valueLabel: '42.0%',
                  marker: 60,
                ),
                BarRow(
                  label: 'A very long sector name that must ellipsize',
                  value: 8,
                  valueLabel: '8.0%',
                  tone: ChartTone.warn,
                ),
              ],
              animate: false,
            ),
            width: 220,
            textScale: 2,
          ),
        );
        expect(find.text('Technology'), findsOneWidget);
        expect(find.text('42.0%'), findsOneWidget);
        expect(find.byType(BarStrip), findsNWidgets(2));
        expect(t.takeException(), isNull);
        await t.pumpWidget(harness(const BarStripList(rows: [])));
        expect(find.byType(BarStrip), findsNothing);
      },
    );
  });

  group('DiffBars', () {
    testWidgets('colors by sign around one zero axis and reads the values', (
      t,
    ) async {
      await t.pumpWidget(
        harness(
          const DiffBars(
            rows: [
              DiffBarRow(label: 'Run A', value: 4.2),
              DiffBarRow(label: 'Run B', value: -2.1),
              DiffBarRow(label: 'Run C', value: 0),
            ],
          ),
        ),
      );
      expect(find.text('+4.2'), findsOneWidget);
      expect(find.text('\u22122.1'), findsOneWidget);
      expect(find.text('0.0'), findsOneWidget);
      final rows = find.descendant(
        of: find.byType(DiffBars),
        matching: find.byType(CustomPaint),
      );
      expect(rows, findsNWidgets(3));
      for (final i in [0, 1]) {
        expect(
          t.renderObject(rows.at(i)),
          paints
            ..something(rawPoints)
            ..rect()
            ..line(),
        );
      }
      // Zero draws the axis only.
      expect(t.renderObject(rows.at(2)), paints..line());
      expect(t.renderObject(rows.at(2)), isNot(paints..something(rawPoints)));
    });

    testWidgets(
      'semantics lists every row; empty, NaN and one-sided data survive',
      (t) async {
        final h = t.ensureSemantics();
        await t.pumpWidget(
          harness(
            const DiffBars(
              rows: [
                DiffBarRow(label: 'A', value: 1),
                DiffBarRow(label: 'B', value: -1),
              ],
            ),
          ),
        );
        expect(find.bySemanticsLabel('A +1.0, B \u22121.0'), findsOneWidget);
        await t.pumpWidget(harness(const DiffBars(rows: [])));
        await t.pumpWidget(
          harness(
            const DiffBars(
              rows: [DiffBarRow(label: 'N', value: double.nan)],
            ),
          ),
        );
        await t.pumpWidget(
          harness(
            const DiffBars(
              rows: [
                DiffBarRow(label: 'P', value: 5),
                DiffBarRow(label: 'Q', value: 9),
              ],
            ),
          ),
        );
        expect(t.takeException(), isNull);
        h.dispose();
      },
    );
  });

  group('ColumnChart', () {
    testWidgets('draws dither columns and the zero axis', (t) async {
      await t.pumpWidget(
        harness(
          ColumnChart(
            categories: ['a', 'b', 'c', 'd'],
            series: const [
              ColumnSeries(values: [3, -2, 5, 1], name: 'P&L'),
            ],
            colorBySign: true,
          ),
          height: 200,
        ),
      );
      await t.pumpAndSettle();
      expect(
        dataLayer(t, find.byType(ColumnChart)),
        paints
          ..something(rawPoints)
          ..something(rawPoints)
          ..rect(),
      );
    });

    testWidgets(
      'scrub reports the column under the finger and lists series values',
      (t) async {
        final events = <int?>[];
        await t.pumpWidget(
          harness(
            ColumnChart(
              categories: const ['40-50', '50-60', '60-70', '70-80'],
              series: const [
                ColumnSeries(name: 'Predicted', values: [45, 55, 65, 75]),
                ColumnSeries(name: 'Realized', values: [30, 58, 40, 80]),
              ],
              onScrub: events.add,
              enableHaptics: false,
              animate: false,
            ),
            height: 200,
          ),
        );
        final origin = t.getTopLeft(find.byType(ColumnChart));
        final g = await t.startGesture(origin + const Offset(3, 100));
        await g.moveTo(origin + const Offset(400, 100));
        await t.pump();
        expect(events.whereType<int>().first, 0);
        expect(events.whereType<int>().last, 3);
        expect(find.text('70-80'), findsOneWidget);
        expect(find.text('75'), findsOneWidget);
        expect(find.text('80'), findsOneWidget);
        await g.up();
        await t.pump();
        expect(events.last, isNull);
      },
    );

    for (final c in <String, ColumnChart>{
      'empty': const ColumnChart(categories: [], series: []),
      'no finite values': const ColumnChart(
        categories: ['a'],
        series: [
          ColumnSeries(values: [double.nan]),
        ],
      ),
      'all zero': const ColumnChart(
        categories: ['a', 'b'],
        series: [
          ColumnSeries(values: [0, 0]),
        ],
      ),
      'stacked with negatives': const ColumnChart(
        categories: ['a', 'b'],
        stacked: true,
        series: [
          ColumnSeries(values: [3, -1]),
          ColumnSeries(values: [-2, 4]),
        ],
      ),
      '2000 bars': ColumnChart(
        categories: const [],
        series: [ColumnSeries(values: ramp(2000))],
      ),
      'more values than categories': const ColumnChart(
        categories: ['a'],
        series: [
          ColumnSeries(values: [1, 2, 3]),
        ],
      ),
    }.entries) {
      testWidgets('survives ${c.key}', (t) async {
        await t.pumpWidget(harness(c.value, height: 200));
        await t.pumpAndSettle();
        expect(t.takeException(), isNull);
      });
    }

    testWidgets('zero width does not throw', (t) async {
      await t.pumpWidget(
        harness(
          ColumnChart(
            categories: const ['a'],
            series: const [
              ColumnSeries(values: [1]),
            ],
          ),
          width: 0,
        ),
      );
      expect(t.takeException(), isNull);
    });
  });

  group('CalibrationChart', () {
    const points = [
      CalibrationPoint(predicted: 55, realized: 58, count: 10, label: '50-60%'),
      CalibrationPoint(predicted: 65, realized: 40, count: 25, label: '60-70%'),
      CalibrationPoint(predicted: 75, realized: 80, count: 5, label: '70-80%'),
    ];

    testWidgets('draws the diagonal, one dot per bucket, and selects by x', (
      t,
    ) async {
      final events = <int?>[];
      await t.pumpWidget(
        harness(
          CalibrationChart(
            points: points,
            onSelect: events.add,
            enableHaptics: false,
            animate: false,
          ),
          height: 220,
        ),
      );
      expect(
        dataLayer(t, find.byType(CalibrationChart)),
        paints
          ..path()
          ..circle()
          ..circle()
          ..circle()
          ..circle()
          ..circle()
          ..circle(),
      );
      final origin = t.getTopLeft(find.byType(CalibrationChart));
      final g = await t.startGesture(origin + const Offset(3, 100));
      await g.moveTo(origin + const Offset(300, 100));
      await t.pump();
      expect(events.whereType<int>().first, 0);
      expect(events.whereType<int>().last, 2);
      expect(find.text('5 trades'), findsOneWidget);
      expect(find.text('Predicted 75%  Realized 80%'), findsOneWidget);
      await g.up();
      await t.pump();
      expect(events.last, isNull);
    });

    testWidgets('semantics report the worst shortfall', (t) async {
      final h = t.ensureSemantics();
      await t.pumpWidget(
        harness(const CalibrationChart(points: points), height: 220),
      );
      expect(
        find.bySemanticsLabel(RegExp(r'3 buckets.*worst shortfall 25%')),
        findsOneWidget,
      );
      h.dispose();
    });

    for (final c in <String, List<CalibrationPoint>>{
      'empty': [],
      'NaN bucket': [
        const CalibrationPoint(predicted: double.nan, realized: 5),
      ],
      'out of range': [
        const CalibrationPoint(predicted: 150, realized: -20, count: 0),
      ],
    }.entries) {
      testWidgets('survives ${c.key}', (t) async {
        await t.pumpWidget(
          harness(CalibrationChart(points: c.value), height: 220),
        );
        await t.pumpAndSettle();
        expect(t.takeException(), isNull);
      });
    }
  });

  group('ExcessStrip', () {
    const runs = [
      ExcessDot(id: 'r1', label: 'Crash', variant: 'Baseline', value: 4.5),
      ExcessDot(id: 'r2', label: 'Rally', variant: 'Baseline', value: -2.0),
      ExcessDot(id: 'r3', label: 'Crash', variant: 'Tight stop', value: 1.0),
      ExcessDot(id: 'r4', label: 'Open', variant: 'Tight stop', value: null),
    ];

    testWidgets(
      'sizes itself from the lane count and describes every plotted run',
      (t) async {
        final h = t.ensureSemantics();
        await t.pumpWidget(
          harness(
            const ExcessStrip(runs: runs, variants: ['Baseline', 'Tight stop']),
          ),
        );
        expect(t.getSize(find.byType(ExcessStrip)).height, 8 + 2 * 32 + 18);
        expect(
          find.bySemanticsLabel(
            RegExp(r'Crash \+4\.5, Rally \u22122\.0, Crash \+1\.0$'),
          ),
          findsOneWidget,
        );
        h.dispose();
      },
    );

    testWidgets('lane height grows with text size', (t) async {
      await t.pumpWidget(
        harness(
          const ExcessStrip(runs: runs, variants: ['Baseline']),
          textScale: 2,
        ),
      );
      expect(t.getSize(find.byType(ExcessStrip)).height, 8 + 64 + 36);
    });

    testWidgets('tapping near a dot reports it; tapping empty space does not', (
      t,
    ) async {
      final hits = <String>[];
      await t.pumpWidget(
        harness(
          ExcessStrip(
            runs: runs,
            variants: const ['Baseline', 'Tight stop'],
            onDotTap: (d) => hits.add(d.id),
          ),
        ),
      );
      final box = t.getTopLeft(find.byType(ExcessStrip));
      // The highest value sits at the right end of the first lane.
      await t.tapAt(box + Offset(320 - 12, 8 + 32 * 0.62));
      expect(hits, ['r1']);
      await t.tapAt(box + const Offset(160, 8 + 32 * 0.62 - 20));
      expect(hits, ['r1']);
    });

    for (final c in <String, List<ExcessDot>>{
      'no runs': [],
      'all null': [
        const ExcessDot(id: 'x', label: 'x', variant: 'A', value: null),
      ],
      'single value': [
        const ExcessDot(id: 'x', label: 'x', variant: 'A', value: 3),
      ],
      'unknown variant': [
        const ExcessDot(id: 'x', label: 'x', variant: 'Z', value: 3),
      ],
      'infinite': [
        const ExcessDot(
          id: 'x',
          label: 'x',
          variant: 'A',
          value: double.infinity,
        ),
      ],
    }.entries) {
      testWidgets('survives ${c.key}', (t) async {
        await t.pumpWidget(
          harness(ExcessStrip(runs: c.value, variants: const ['A'])),
        );
        expect(t.takeException(), isNull);
      });
    }

    testWidgets('no variants renders nothing', (t) async {
      await t.pumpWidget(harness(const ExcessStrip(runs: [], variants: [])));
      expect(t.takeException(), isNull);
    });
  });

  group('CandleChart', () {
    List<CandleBar> bars(int n) => [
      for (var i = 0; i < n; i++)
        CandleBar(
          open: 100 + i * 0.5,
          close: 100 + i * 0.5 + (i.isEven ? 1.5 : -1.0),
          high: 103 + i * 0.5,
          low: 98 + i * 0.5,
          volume: 1e6 + i * 1e4,
        ),
    ];

    testWidgets('draws volume, candles and moving averages', (t) async {
      await t.pumpWidget(
        harness(
          CandleChart(
            bars: bars(80),
            smaPeriods: const [20, 50],
            referenceLines: const [
              ChartReferenceLine(
                value: 99,
                label: 'Stop',
                tone: ChartTone.loss,
              ),
            ],
            markers: const [
              ChartMarker(index: 10, kind: ChartMarkerKind.buy),
              ChartMarker(index: 70, kind: ChartMarkerKind.sell),
            ],
          ),
          height: 320,
        ),
      );
      await t.pumpAndSettle();
      expect(
        dataLayer(t, find.byType(CandleChart)),
        paints
          ..rect()
          ..line()
          ..rect()
          ..path()
          ..path()
          ..path(),
      );
    });

    testWidgets('scrub shows OHLC for the bar and reports its index', (
      t,
    ) async {
      final events = <int?>[];
      await t.pumpWidget(
        harness(
          CandleChart(
            bars: bars(10),
            labels: [for (var i = 0; i < 10; i++) '2026-05-${i + 10}'],
            onScrub: events.add,
            enableHaptics: false,
            animate: false,
          ),
          height: 320,
        ),
      );
      final origin = t.getTopLeft(find.byType(CandleChart));
      final g = await t.startGesture(origin + const Offset(3, 100));
      await g.moveTo(origin + const Offset(300, 100));
      await t.pump();
      expect(events.whereType<int>().first, 0);
      expect(events.whereType<int>().last, 9);
      expect(find.text('2026-05-19'), findsOneWidget);
      await g.up();
    });

    testWidgets(
      'more bars than pixels are merged, indices still map to real bars',
      (t) async {
        final events = <int?>[];
        await t.pumpWidget(
          harness(
            CandleChart(
              bars: bars(2000),
              onScrub: events.add,
              enableHaptics: false,
              animate: false,
            ),
            height: 320,
          ),
        );
        final origin = t.getTopLeft(find.byType(CandleChart));
        final g = await t.startGesture(origin + const Offset(3, 100));
        await g.moveTo(origin + const Offset(300, 100));
        await t.pump();
        final live = events.whereType<int>();
        expect(live.every((i) => i >= 0 && i < 2000), isTrue);
        expect(live.last, greaterThan(1800));
        await g.up();
        expect(t.takeException(), isNull);
      },
    );

    test('aggregateCandles merges OHLC correctly', () {
      final merged = aggregateCandles(const [
        CandleBar(open: 10, high: 12, low: 9, close: 11, volume: 5),
        CandleBar(open: 11, high: 15, low: 10, close: 14, volume: 7),
        CandleBar(open: 14, high: 14, low: 8, close: 9, volume: 1),
      ], 2);
      expect(merged.length, 2);
      final first = merged[0]!;
      expect(
        (first.open, first.high, first.low, first.close, first.volume),
        (10.0, 15.0, 9.0, 14.0, 12.0),
      );
      expect(merged[1]!.close, 9);
    });

    for (final c in <String, List<CandleBar>>{
      'empty': [],
      'one bar': [const CandleBar(open: 1, high: 2, low: 0.5, close: 1.5)],
      'flat doji': [
        for (var i = 0; i < 5; i++)
          const CandleBar(open: 5, high: 5, low: 5, close: 5),
      ],
      'NaN bar': [
        const CandleBar(open: double.nan, high: 2, low: 1, close: 1.5),
        const CandleBar(open: 1, high: 2, low: 1, close: 1.5),
      ],
      'no volume': [
        for (var i = 0; i < 5; i++)
          CandleBar(open: 1.0 + i, high: 2.0 + i, low: 0.5 + i, close: 1.5 + i),
      ],
    }.entries) {
      testWidgets('survives ${c.key}', (t) async {
        await t.pumpWidget(
          harness(
            CandleChart(
              bars: c.value,
              markers: const [
                ChartMarker(index: 0, kind: ChartMarkerKind.buy),
                ChartMarker(index: 9),
              ],
            ),
            height: 320,
          ),
        );
        await t.pumpAndSettle();
        expect(t.takeException(), isNull);
      });
    }

    testWidgets('zero width does not throw', (t) async {
      await t.pumpWidget(harness(CandleChart(bars: bars(3)), width: 0));
      expect(t.takeException(), isNull);
    });
  });
}
