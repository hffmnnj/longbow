import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/features/lab/compare_page.dart';
import 'package:longbow/features/lab/run_page.dart';
import 'package:longbow/features/lab/suite_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'lab_support.dart';

SimSuite _suite({String status = 'done', Map<String, dynamic>? comparison}) {
  final json = {...(_raw()), 'status': status, 'comparison': ?comparison};
  return SimSuite.fromJson(json);
}

Map<String, dynamic> _raw() {
  final s = fixtureSuites().first;
  // Round-trip through the fixture file's own JSON via the model's config.
  return {
    'id': s.id,
    'createdAt': s.createdAt,
    'startedBy': 'agent',
    'config': s.config.toJson(),
    'status': 'done',
    'runs': [
      for (final e in s.runs)
        {
          'runId': e.runId,
          'variant': e.variant,
          'scenario': ?e.scenario,
          'seed': ?e.seed,
          'mode': e.mode.name,
        },
    ],
    'summary': [
      for (final v in s.summary)
        {
          'label': v.label,
          'runs': v.runs,
          'done': v.done,
          'failed': v.failed,
          'meanReturnPct': v.meanReturnPct,
          'medianReturnPct': v.medianReturnPct,
          'p10ReturnPct': v.p10ReturnPct,
          'p90ReturnPct': v.p90ReturnPct,
          'meanExcessPct': v.meanExcessPct,
          'beatBenchmarkPct': v.beatBenchmarkPct,
          'worstDrawdownPct': v.worstDrawdownPct,
          'medianSharpe': v.medianSharpe,
          'winRatePct': v.winRatePct,
          'avgR': v.avgR,
          'costsPct': v.costsPct,
        },
    ],
    'comparison': {
      'metric': s.comparison!.metric,
      'meanDiff': s.comparison!.meanDiff,
      'ci95': s.comparison!.ci95,
      'pairs': s.comparison!.pairs,
    },
  };
}

Future<StoreHarness> _open(
  WidgetTester tester,
  SimSuite suite, {
  Size size = const Size(360, 800),
  double scale = 1,
}) async {
  final h = await labHarness(tester, suites: [suite]);
  await pumpScreen(
    tester,
    SuitePage(suiteId: suite.id),
    harness: h,
    size: size,
    textScale: scale,
  );
  await settle(tester);
  return h;
}

void main() {
  testWidgets(
    'a finished suite shows the verdict, per-variant summary, excess strip and member runs',
    (tester) async {
      await _open(tester, fixtureSuites().first);

      expect(find.text('ETF five-day-low branch filter pilot'), findsOneWidget);
      expect(find.text('PAPER MONEY'), findsOneWidget);
      expect(find.text('Done'), findsOneWidget);
      // The reading comes from comparisonReading: A edged B by 0.0 points and the
      // interval touches zero, so it is not conclusive.
      expect(
        find.textContaining(
          'A current OR rule beat B RSI-only filter by 0.0 points',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('not conclusive'), findsOneWidget);
      expect(
        find.text('Excess return over the benchmark, paired across 3 markets.'),
        findsOneWidget,
      );

      expect(find.text('VARIANT SUMMARY'), findsOneWidget);
      expect(find.text('Mean return'), findsOneWidget);
      expect(find.text('Beat benchmark'), findsOneWidget);
      expect(
        find.text('67%'),
        findsNWidgets(2),
      ); // both variants beat SPY in 2 of 3 markets
      expect(find.text('0.50%'), findsOneWidget); // A worst drawdown
      expect(find.text('0.52%'), findsOneWidget); // B worst drawdown
      expect(find.text('3/3'), findsNWidgets(2));

      await reveal(tester, find.byType(ExcessStrip));
      expect(find.byType(ExcessStrip), findsOneWidget);
      expect(find.text('MARKETS · A CURRENT OR RULE'), findsOneWidget);
      expect(find.text('MARKETS · B RSI-ONLY FILTER'), findsOneWidget);
    },
  );

  testWidgets(
    'a conclusive comparison is marked in the lab color and reads as conclusive',
    (tester) async {
      final suite = _suite(
        comparison: {
          'metric': 'excessReturnPct',
          'meanDiff': 1.2,
          'ci95': [0.4, 2.0],
          'pairs': 5,
        },
      );
      await _open(tester, suite);

      expect(
        find.textContaining(
          'B RSI-only filter beat A current OR rule by 1.2 points',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining('95% interval 0.4 to 2.0; conclusive'),
        findsOneWidget,
      );
      expect(find.textContaining('not conclusive'), findsNothing);
    },
  );

  testWidgets('tapping a market opens that member run', (tester) async {
    await _open(tester, fixtureSuites().first);
    // steady-bull-2021 is not in the scenario fixture, so the tile shows the id.
    final tile = find.text('steady-bull-2021').last;
    await reveal(tester, tile);
    await tester.tap(tile);
    await settle(tester);

    expect(find.byType(RunPage), findsOneWidget);
    expect(
      tester.widget<RunPage>(find.byType(RunPage)).runId,
      '20261025040601021-b2732a',
    );
  });

  testWidgets(
    'a running suite shows progress and Stop only after confirmation',
    (tester) async {
      final suite = _suite(status: 'running');
      final h = await _open(tester, suite);
      h.api.on(
        'simSuiteStop',
        () async => suite.copyWith(status: SimRunStatus.stopped),
      );

      expect(find.text('Running'), findsOneWidget);
      await tester.tap(find.widgetWithText(OutlinedButton, 'Stop'));
      await settle(tester);
      expect(find.text('Stop this suite?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await settle(tester);
      expect(h.api.count('simSuiteStop'), 0);

      await tester.tap(find.widgetWithText(OutlinedButton, 'Stop'));
      await settle(tester);
      await tester.tap(find.text('Stop suite'));
      await settle(tester);

      expect(h.api.count('simSuiteStop'), 1);
      expect(find.text('Stopped'), findsOneWidget);
    },
  );

  testWidgets('an unknown suite id says the suite was not found', (
    tester,
  ) async {
    final h = await labHarness(tester);
    await pumpScreen(tester, const SuitePage(suiteId: 'nope'), harness: h);
    await settle(tester);

    expect(find.text('Suite not found'), findsOneWidget);
  });

  testWidgets(
    'compare view shows both runs in the chart legend and every metric row',
    (tester) async {
      final runs = fixtureRuns();
      final h = await labHarness(tester, runs: runs);
      await pumpScreen(
        tester,
        ComparePage(runIds: [for (final r in runs) r.id]),
        harness: h,
      );
      await settle(tester);

      expect(find.text('Compare 2 runs'), findsOneWidget);
      expect(find.byType(MultiLineChart), findsOneWidget);
      expect(find.text('EQUITY INDEXED TO 100'), findsOneWidget);
      expect(find.text('Window'), findsOneWidget);
      expect(find.text('Return'), findsOneWidget);
      expect(find.text('Vs benchmark'), findsOneWidget);
      // Blind run 8.71% behind SPY, bootstrap run 3.32% ahead of it (returns are 0 and 0).
      expect(find.text('\u22128.71%'), findsOneWidget);
      expect(find.text('+3.32%'), findsOneWidget);
    },
  );

  testWidgets('compare with fewer than two runs left explains what to do', (
    tester,
  ) async {
    final runs = fixtureRuns();
    final h = await labHarness(tester, runs: runs);
    await pumpScreen(
      tester,
      ComparePage(runIds: [runs.first.id, 'gone']),
      harness: h,
    );
    await settle(tester);

    expect(find.text('Not enough runs'), findsOneWidget);
    expect(find.byType(MultiLineChart), findsNothing);
  });
}
