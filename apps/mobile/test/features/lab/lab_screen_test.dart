import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/lab/compare_page.dart';
import 'package:longbow/features/lab/lab_cards.dart';
import 'package:longbow/features/lab/lab_screen.dart';
import 'package:longbow/features/lab/lab_widgets.dart';
import 'package:longbow/features/lab/run_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'lab_support.dart';

const _blindTitle =
    'ETF five-day-low branch filter pilot · B RSI-only filter · steady-bull-2021';
const _bootstrapTitle =
    'ETF five-day-low branch filter pilot · B RSI-only filter · bootstrap-1';

void main() {
  testWidgets(
    'runs tab lists every run with title, status, returns and the paper marker',
    (tester) async {
      final h = await labHarness(tester);
      await pumpScreen(tester, const LabScreen(), harness: h);
      await settle(tester);

      expect(find.text('PAPER MONEY'), findsOneWidget);
      expect(find.byType(RunCard), findsNWidgets(2));
      expect(find.text(_blindTitle), findsOneWidget);
      expect(find.text(_bootstrapTitle), findsOneWidget);
      expect(find.text('Done'), findsNWidgets(2));
      // Blind run: 0% return against SPY +8.71%; bootstrap run: SPY -3.32%.
      expect(find.text('+8.71%'), findsOneWidget);
      expect(find.text('\u22123.32%'), findsOneWidget);
      expect(find.text('Blind \u00b7 fictional dates'), findsOneWidget);
      expect(find.text('By agent'), findsNWidgets(2));
      expect(find.text('New simulation'), findsOneWidget);
    },
  );

  testWidgets(
    'suites tab lists suites with progress, variants and the verdict',
    (tester) async {
      final h = await labHarness(tester);
      await pumpScreen(tester, const LabScreen(), harness: h);
      await settle(tester);

      await tester.tap(find.text('Suites'));
      await settle(tester);

      expect(find.byType(SuiteCard), findsOneWidget);
      expect(find.text('ETF five-day-low branch filter pilot'), findsOneWidget);
      // One of the five member runs is in the run list and finished.
      expect(find.textContaining('1 of 5 runs done'), findsOneWidget);
      expect(
        find.textContaining('A current OR rule vs B RSI-only filter'),
        findsOneWidget,
      );
      expect(find.textContaining('excess, 95%'), findsOneWidget);
      expect(find.text('New suite'), findsOneWidget);
    },
  );

  testWidgets(
    'a running run shows progress and updates when an event arrives',
    (tester) async {
      final running = fixtureRun().copyWith(
        status: SimRunStatus.running,
        progress: const SimProgress(
          day: 3,
          days: 10,
          cycle: 1,
          cyclesPerDay: 2,
        ),
        currentDate: '2031-04-02',
      );
      final h = await labHarness(tester, runs: [running]);
      await pumpScreen(tester, const LabScreen(), harness: h);
      await settle(tester);

      expect(
        find.textContaining('Day 3 of 10 · Apr 2 · cycle 1/2'),
        findsOneWidget,
      );
      expect(find.text('1 running'), findsOneWidget);
      expect(
        tester.widget<LabProgress>(find.byType(LabProgress)).value,
        closeTo(0.3, 1e-9),
      );

      h.simStore.apply(
        SimEvent(
          running.copyWith(
            progress: const SimProgress(
              day: 6,
              days: 10,
              cycle: 2,
              cyclesPerDay: 2,
            ),
          ),
        ),
      );
      await settle(tester);

      expect(find.textContaining('Day 6 of 10'), findsOneWidget);
      expect(find.textContaining('Day 3 of 10'), findsNothing);
      expect(
        tester.widget<LabProgress>(find.byType(LabProgress)).value,
        closeTo(0.6, 1e-9),
      );
    },
  );

  testWidgets('empty lab explains simulations and offers a first one', (
    tester,
  ) async {
    final h = await labHarness(tester, runs: [], suites: []);
    await pumpScreen(tester, const LabScreen(), harness: h);
    await settle(tester);

    expect(find.text('No simulations yet'), findsOneWidget);
    expect(
      find.textContaining('replays past trading days against a paper broker'),
      findsOneWidget,
    );
    expect(find.widgetWithText(FilledButton, 'New simulation'), findsOneWidget);
    expect(find.byType(RunCard), findsNothing);

    await tester.tap(find.text('Suites'));
    await settle(tester);
    expect(find.text('No suites yet'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'New suite'), findsOneWidget);
  });

  testWidgets('loading shows skeletons that stand where the cards will be', (
    tester,
  ) async {
    final h = (await tester.runAsync(StoreHarness.create))!;
    addTearDown(h.dispose);
    h.api.on('simRuns', () => Completer<List<SimRun>>().future);
    h.api.on('simSuites', () async => <SimSuite>[]);
    await pumpScreen(tester, const LabScreen(), harness: h);
    await tester.pump();

    expect(find.byType(SkeletonBlock), findsNWidgets(3));
    expect(find.byType(RunCard), findsNothing);
    expect(find.text('No simulations yet'), findsNothing);
  });

  testWidgets('a failed load shows the error with Retry, and Retry recovers', (
    tester,
  ) async {
    final h = (await tester.runAsync(StoreHarness.create))!;
    addTearDown(h.dispose);
    h.api.on('simSuites', () async => <SimSuite>[]);
    h.api.fail('simRuns', const ApiError(500, 'server fell over'));
    await pumpScreen(tester, const LabScreen(), harness: h);
    await settle(tester);

    expect(find.text('Could not load simulations'), findsOneWidget);
    expect(find.text('server fell over'), findsOneWidget);

    h.api.on('simRuns', () async => fixtureRuns());
    await tester.tap(find.text('Retry'));
    await settle(tester);

    expect(find.byType(RunCard), findsNWidgets(2));
    expect(find.text('Could not load simulations'), findsNothing);
  });

  testWidgets(
    'offline shows the stale banner above the data that stays on screen',
    (tester) async {
      final h = await labHarness(tester, start: true);
      await pumpScreen(tester, const LabScreen(), harness: h);
      await settle(tester);
      expect(find.byType(StaleBanner), findsNothing);

      h.events.onClose();
      await settle(tester);

      expect(find.byType(StaleBanner), findsOneWidget);
      expect(find.byType(RunCard), findsNWidgets(2));
    },
  );

  testWidgets(
    'ticking two runs offers Compare, which opens the side-by-side view',
    (tester) async {
      final h = await labHarness(tester);
      await pumpScreen(tester, const LabScreen(), harness: h);
      await settle(tester);

      expect(find.textContaining('Compare 2'), findsNothing);
      await tester.tap(find.bySemanticsLabel('Compare $_blindTitle'));
      await settle(tester);
      // One tick is not a comparison yet.
      expect(find.textContaining('Compare 1'), findsNothing);
      expect(find.text('New simulation'), findsOneWidget);

      await tester.tap(find.bySemanticsLabel('Compare $_bootstrapTitle'));
      await settle(tester);
      expect(h.container.read(simCompareProvider), hasLength(2));
      expect(find.text('Compare 2 runs'), findsOneWidget);
      expect(find.text('New simulation'), findsNothing);

      await tester.tap(find.text('Compare 2 runs'));
      await settle(tester);

      expect(find.byType(ComparePage), findsOneWidget);
      expect(find.byType(MultiLineChart), findsOneWidget);
      expect(find.text('METRICS SIDE BY SIDE'), findsOneWidget);
      // Both run labels head the table columns and the chart legend.
      expect(find.text(_blindTitle), findsWidgets);
      expect(find.text(_bootstrapTitle), findsWidgets);
      expect(find.text('Max drawdown'), findsOneWidget);
      expect(find.text('Window'), findsOneWidget);
    },
  );

  testWidgets('clearing the selection returns the New simulation action', (
    tester,
  ) async {
    final h = await labHarness(tester);
    await pumpScreen(tester, const LabScreen(), harness: h);
    await settle(tester);
    final boxes = find.byType(Checkbox);
    await tester.tap(boxes.at(0));
    await tester.tap(boxes.at(1));
    await settle(tester);
    expect(find.text('Compare 2 runs'), findsOneWidget);

    await tester.tap(find.byTooltip('Clear selection'));
    await settle(tester);

    expect(h.container.read(simCompareProvider), isEmpty);
    expect(find.text('Compare 2 runs'), findsNothing);
    expect(find.text('New simulation'), findsOneWidget);
  });

  testWidgets('tapping a run card opens that run', (tester) async {
    final h = await labHarness(tester);
    await pumpScreen(tester, const LabScreen(), harness: h);
    await settle(tester);

    await tester.tap(find.text(_blindTitle));
    await settle(tester);

    expect(find.byType(RunPage), findsOneWidget);
    expect(
      tester.widget<RunPage>(find.byType(RunPage)).runId,
      '20261025040601021-b2732a',
    );
  });
}
