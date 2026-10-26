import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/lab/compare_page.dart';
import 'package:longbow/features/lab/lab_cards.dart';
import 'package:longbow/features/lab/lab_screen.dart';
import 'package:longbow/features/lab/new_sim_sheet.dart';
import 'package:longbow/features/lab/new_suite_sheet.dart';
import 'package:longbow/features/lab/run_page.dart';
import 'package:longbow/features/lab/suite_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'lab_support.dart';

const _phone = Size(360, 640);
const _desktop = Size(840, 900);

SimRun _busyRun() => fixtureRun({
  'fills': [
    for (var i = 0; i < 25; i++)
      fillJson(
        symbol: i.isEven ? 'MKT' : 'STECH',
        side: i.isEven ? 'buy' : 'sell',
      ),
  ],
  'positions': [positionJson('SFIN'), positionJson('SENGY')],
  'metrics': {
    ...(fixtureRunJson()['metrics'] as Map<String, dynamic>),
    'riskBlocks': {
      'max_sector_exposure_for_a_very_long_rule_name': 12,
      'max_positions': 1,
    },
  },
});

Future<void> _scroll(WidgetTester tester) async {
  final scroll = find.byType(Scrollable).first;
  await tester.drag(scroll, const Offset(0, -600));
  await tester.pump();
}

void main() {
  group('360x640 at text scale 2.0', () {
    Future<StoreHarness> pumpAt(
      WidgetTester tester,
      Widget screen, {
      List<SimRun>? runs,
    }) async {
      final h = await labHarness(tester, runs: runs, start: true);
      await pumpScreen(
        tester,
        screen,
        harness: h,
        size: _phone,
        textScale: 2.0,
      );
      await settle(tester);
      return h;
    }

    testWidgets('lab runs and suites lists lay out without overflow', (
      tester,
    ) async {
      final running = fixtureRun().copyWith(status: SimRunStatus.running);
      await pumpAt(
        tester,
        const LabScreen(),
        runs: [running, ...fixtureRuns()],
      );
      expect(find.byType(RunCard), findsWidgets);
      await _scroll(tester);
      await tester.drag(find.byType(Scrollable).first, const Offset(0, 600));
      await tester.pump();
      await tester.tap(find.text('Suites'));
      await settle(tester);
      expect(find.byType(SuiteCard), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the empty lab lays out without overflow', (tester) async {
      await pumpAt(tester, const LabScreen(), runs: []);
      expect(find.text('No simulations yet'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    for (final section in ['Overview', 'Trades', 'Agent']) {
      testWidgets('run page $section lays out without overflow', (
        tester,
      ) async {
        final run = _busyRun().copyWith(
          status: SimRunStatus.running,
          error: 'A long failure message that has to wrap on a narrow screen',
        );
        await pumpAt(tester, RunPage(runId: run.id), runs: [run]);
        await tester.ensureVisible(find.text(section));
        await tester.pump();
        await tester.tap(find.text(section));
        await settle(tester);
        expect(find.byType(RunPage), findsOneWidget);
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await settle(tester);
        await _scroll(tester);
        await _scroll(tester);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('suite page lays out without overflow', (tester) async {
      final h = await pumpAt(
        tester,
        SuitePage(suiteId: fixtureSuites().first.id),
      );
      expect(find.text('VARIANT SUMMARY'), findsOneWidget);
      await _scroll(tester);
      await _scroll(tester);
      expect(h.sim.suites, hasLength(1));
      expect(tester.takeException(), isNull);
    });

    testWidgets('compare page lays out without overflow', (tester) async {
      final runs = fixtureRuns();
      await pumpAt(
        tester,
        ComparePage(runIds: [for (final r in runs) r.id]),
        runs: runs,
      );
      expect(find.text('METRICS SIDE BY SIDE'), findsOneWidget);
      await _scroll(tester);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the new simulation form lays out with risk overrides open', (
      tester,
    ) async {
      final h = await labHarness(tester, start: true);
      await pumpScreen(
        tester,
        launcher(showNewSimSheet),
        harness: h,
        size: _phone,
        textScale: 2.0,
      );
      await tester.tap(find.text('Open'));
      await settle(tester);
      await tester.ensureVisible(find.text('Risk overrides'));
      await tester.tap(find.text('Risk overrides'));
      await settle(tester);
      await tester.ensureVisible(find.text('Start simulation'));
      expect(find.text('Start simulation'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the new suite form lays out', (tester) async {
      final h = await labHarness(tester, start: true);
      await pumpScreen(
        tester,
        launcher(showNewSuiteSheet),
        harness: h,
        size: _phone,
        textScale: 2.0,
      );
      await tester.tap(find.text('Open'));
      await settle(tester);
      await tester.ensureVisible(find.text('Start suite'));
      expect(find.text('Start suite'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('840x900', () {
    testWidgets('run cards sit in two columns', (tester) async {
      final h = await labHarness(tester);
      await pumpScreen(tester, const LabScreen(), harness: h, size: _desktop);
      await settle(tester);

      final first = tester.getTopLeft(find.byType(RunCard).at(0));
      final second = tester.getTopLeft(find.byType(RunCard).at(1));
      expect(second.dy, first.dy);
      expect(second.dx, greaterThan(first.dx + 300));
    });

    testWidgets('run overview puts the chart and the metrics side by side', (
      tester,
    ) async {
      final run = _busyRun();
      final h = await labHarness(tester, runs: [run]);
      await pumpScreen(
        tester,
        RunPage(runId: run.id),
        harness: h,
        size: _desktop,
      );
      await settle(tester);

      final chart = tester.getTopLeft(find.text('EQUITY AGAINST SPY'));
      final metrics = tester.getTopLeft(find.text('RETURN AND RISK'));
      expect(metrics.dy, chart.dy);
      expect(metrics.dx, greaterThan(chart.dx + 300));
    });

    testWidgets('suite page puts the summary and the markets side by side', (
      tester,
    ) async {
      final h = await labHarness(tester);
      await pumpScreen(
        tester,
        SuitePage(suiteId: fixtureSuites().first.id),
        harness: h,
        size: _desktop,
      );
      await settle(tester);

      final summary = tester.getTopLeft(find.text('VARIANT SUMMARY'));
      final markets = tester.getTopLeft(
        find.text('MARKETS · A CURRENT OR RULE'),
      );
      expect(markets.dy, summary.dy);
      expect(markets.dx, greaterThan(summary.dx + 300));
    });
  });
}
