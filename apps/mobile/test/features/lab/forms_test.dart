import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/lab/new_sim_sheet.dart';
import 'package:longbow/features/lab/new_suite_sheet.dart';
import 'package:longbow/features/lab/run_page.dart';
import 'package:longbow/features/lab/suite_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'lab_support.dart';

const _tall = Size(400, 1600);

Future<void> _type(WidgetTester tester, String label, String text) async {
  final f = find.byWidgetPredicate(
    (w) => w is TextField && w.decoration?.labelText == label,
  );
  await tester.ensureVisible(f);
  await tester.enterText(f, text);
  await tester.pump();
}

FilledButton _startButton(WidgetTester tester, String label) =>
    tester.widget<FilledButton>(find.widgetWithText(FilledButton, label));

Future<void> _tap(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pump();
  await tester.tap(f);
  await tester.pump();
}

Future<StoreHarness> _sheetHost(
  WidgetTester tester,
  Future<void> Function(BuildContext) open, {
  Size size = _tall,
}) async {
  final h = await labHarness(tester, start: true);
  await pumpScreen(tester, launcher(open), harness: h, size: size);
  await tester.tap(find.text('Open'));
  await settle(tester);
  return h;
}

void main() {
  group('new simulation', () {
    testWidgets(
      'opens on blind with the first scenario picked, and the estimate follows the scenario',
      (tester) async {
        await _sheetHost(tester, showNewSimSheet);

        expect(find.text('New simulation'), findsWidgets);
        expect(find.text('PAPER MONEY'), findsOneWidget);
        expect(find.text('Volatility shock, Feb 2018'), findsOneWidget);
        expect(find.text('Q4 2018 selloff'), findsOneWidget);
        expect(find.text('Custom dates'), findsOneWidget);
        expect(
          find.textContaining('Real market moves with the dates shifted'),
          findsOneWidget,
        );
        // 35 trading days x 2 cycles x 1.5 min = 105 min.
        expect(find.text('35 trading days · about 1 h 45 min'), findsOneWidget);
        expect(_startButton(tester, 'Start simulation').onPressed, isNotNull);
      },
    );

    testWidgets('picking Bootstrap swaps the scenario list for a day slider', (
      tester,
    ) async {
      await _sheetHost(tester, showNewSimSheet);

      expect(find.text('Bootstrap days'), findsNothing);
      await tester.tap(find.text('Bootstrap'));
      await settle(tester);

      expect(find.text('Volatility shock, Feb 2018'), findsNothing);
      expect(find.text('Bootstrap days'), findsOneWidget);
      // 40 days x 2 cycles x 1.5 min = 120 min.
      expect(find.text('40 bootstrap days · about 2 h'), findsOneWidget);
    });

    testWidgets(
      'custom dates validate the start date against the trading days available',
      (tester) async {
        await _sheetHost(tester, showNewSimSheet);
        await tester.tap(find.text('Custom dates'));
        await settle(tester);

        await _type(tester, 'Start date', '2999-01-04');
        expect(
          find.text('Only 0 trading days between 2999-01-04 and today'),
          findsWidgets,
        );
        expect(_startButton(tester, 'Start simulation').onPressed, isNull);

        await _type(tester, 'Start date', '');
        expect(find.text('Pick a start date'), findsWidgets);

        await _type(tester, 'Start date', '2024-01-02');
        expect(find.textContaining('trading days between'), findsNothing);
        expect(find.text('Pick a start date'), findsNothing);
        expect(_startButton(tester, 'Start simulation').onPressed, isNotNull);
      },
    );

    testWidgets(
      'cash, seed and risk overrides show inline errors and block Start',
      (tester) async {
        await _sheetHost(tester, showNewSimSheet);

        await _type(tester, 'Starting cash', '0');
        expect(find.text('Enter an amount above zero'), findsWidgets);
        expect(_startButton(tester, 'Start simulation').onPressed, isNull);
        await _type(tester, 'Starting cash', '5000000');
        expect(find.text('Max \$1,000,000'), findsWidgets);
        await _type(tester, 'Starting cash', '1500');
        expect(_startButton(tester, 'Start simulation').onPressed, isNotNull);

        await _type(tester, 'Seed', '99999999999');
        expect(find.text('Whole number up to 2147483647'), findsWidgets);
        expect(_startButton(tester, 'Start simulation').onPressed, isNull);
        await _type(tester, 'Seed', '');

        await tester.ensureVisible(find.text('Risk overrides'));
        await tester.tap(find.text('Risk overrides'));
        await settle(tester);
        await _type(tester, 'Risk per trade', '9');
        expect(find.text('Max 5'), findsOneWidget);
        expect(find.text('Fix the risk overrides'), findsOneWidget);
        expect(_startButton(tester, 'Start simulation').onPressed, isNull);
        await _type(tester, 'Risk per trade', '2');
        expect(find.text('Max 5'), findsNothing);
        expect(find.text('1 set'), findsOneWidget);
        expect(_startButton(tester, 'Start simulation').onPressed, isNotNull);
      },
    );

    testWidgets(
      'an empty watchlist blocks Start until a ticker is added; bad tickers are named',
      (tester) async {
        await _sheetHost(tester, showNewSimSheet);
        for (final t in defaultSettings.watchlist) {
          await _tap(tester, find.byTooltip('Remove $t'));
        }
        expect(find.byType(InputChip), findsNothing);
        expect(
          find.text('Add at least one ticker to the watchlist'),
          findsOneWidget,
        );
        expect(_startButton(tester, 'Start simulation').onPressed, isNull);

        await tester.ensureVisible(find.text('Add'));
        final input = find.byWidgetPredicate(
          (w) =>
              w is TextField &&
              w.decoration?.hintText == 'Add tickers, e.g. NVDA AAPL',
        );
        await tester.enterText(input, 'nvda, bad1');
        await tester.tap(find.text('Add'));
        await settle(tester);

        expect(find.text('Not a ticker: bad1'), findsOneWidget);
        expect(find.widgetWithText(InputChip, 'NVDA'), findsOneWidget);
        expect(
          find.text('Add at least one ticker to the watchlist'),
          findsNothing,
        );
        expect(_startButton(tester, 'Start simulation').onPressed, isNotNull);
      },
    );

    testWidgets(
      'Start sends the configured run, closes the sheet, toasts and opens the new run',
      (tester) async {
        final started = fixtureRun();
        SimRunConfig? sent;
        final h = await _sheetHost(tester, showNewSimSheet);
        h.api.handlers['simStart'] = (inv) async {
          sent = inv.positionalArguments.first as SimRunConfig;
          return started;
        };

        await _type(tester, 'Name', 'My first replay');
        await _type(tester, 'Strategy', 'Only buy after two red days.');
        await tester.ensureVisible(find.text('Risk overrides'));
        await tester.tap(find.text('Risk overrides'));
        await settle(tester);
        await _type(tester, 'Risk per trade', '2');
        final three = find.descendant(
          of: find.byType(SegmentedButton<int>),
          matching: find.text('3'),
        );
        await tester.ensureVisible(three);
        await tester.tap(three);
        await tester.pump();
        expect(
          find.textContaining('plus a pre-open check at 09:00 ET'),
          findsOneWidget,
        );
        await tester.ensureVisible(find.text('Start simulation'));
        await tester.tap(find.text('Start simulation'));
        await settle(tester);

        final config = sent!;
        expect(config.name, 'My first replay');
        expect(config.scenario, 'volmageddon-2018');
        expect(config.startDate, isNull);
        expect(config.mode, SimMode.blind);
        expect(config.days, 35);
        expect(config.startingCash, 1200);
        expect(config.cyclesPerDay, 3);
        expect(config.execution, SimExecution.realistic);
        expect(config.model, SimModel.main);
        expect(config.strategy, 'Only buy after two red days.');
        expect(config.risk!.maxRiskPerTradePct, 2);
        expect(config.watchlist, defaultSettings.watchlist);

        expect(find.byType(RunPage), findsOneWidget);
        expect(tester.widget<RunPage>(find.byType(RunPage)).runId, started.id);
        expect(find.text('Simulation started'), findsOneWidget);
        expect(find.text('Start simulation'), findsNothing);
        expect(h.sim.runs.map((r) => r.id), contains(started.id));
      },
    );

    testWidgets(
      'a server refusal stays on the form with the message and Start available again',
      (tester) async {
        final h = await _sheetHost(tester, showNewSimSheet);
        h.api.fail(
          'simStart',
          const ApiError(
            400,
            'Only 3 trading days of history before that date',
          ),
        );

        await tester.ensureVisible(find.text('Start simulation'));
        await tester.tap(find.text('Start simulation'));
        await settle(tester);

        expect(
          find.text('Only 3 trading days of history before that date'),
          findsOneWidget,
        );
        expect(find.text('Start simulation'), findsOneWidget);
        expect(_startButton(tester, 'Start simulation').onPressed, isNotNull);
        expect(h.sim.starting, isFalse);
        expect(find.byType(RunPage), findsNothing);
      },
    );

    testWidgets(
      'without the scenario library the form falls back to custom dates',
      (tester) async {
        final h = await labHarness(tester, scenarios: [], start: true);
        await pumpScreen(
          tester,
          launcher(showNewSimSheet),
          harness: h,
          size: _tall,
        );
        await tester.tap(find.text('Open'));
        await settle(tester);

        expect(
          find.textContaining('scenario library did not load'),
          findsOneWidget,
        );
        expect(find.widgetWithText(TextField, 'Start date'), findsOneWidget);
      },
    );
  });

  group('new suite', () {
    testWidgets(
      'opens with two scenarios picked, two variants and the market count',
      (tester) async {
        await _sheetHost(tester, showNewSuiteSheet);

        expect(find.text('SCENARIOS · 2 PICKED'), findsOneWidget);
        expect(find.text('Variant 1'), findsOneWidget);
        expect(find.text('Variant 2'), findsOneWidget);
        expect(find.text('2 markets × 2 variants'), findsOneWidget);
        // Nothing is named yet.
        expect(find.text('Name the suite'), findsOneWidget);
        expect(_startButton(tester, 'Start suite').onPressed, isNull);
      },
    );

    testWidgets('validates name, markets, and duplicate labels', (
      tester,
    ) async {
      await _sheetHost(tester, showNewSuiteSheet);
      await _type(tester, 'Name', 'Momentum vs defensive');
      expect(_startButton(tester, 'Start suite').onPressed, isNotNull);

      // Untick both scenarios: no markets.
      await _tap(tester, find.text('Volatility shock, Feb 2018'));
      await _tap(tester, find.text('Q4 2018 selloff'));
      expect(
        find.text('Pick at least one scenario or bootstrap market'),
        findsOneWidget,
      );
      expect(_startButton(tester, 'Start suite').onPressed, isNull);
      await _tap(tester, find.text('COVID crash, 2020'));
      expect(find.text('1 market × 2 variants'), findsOneWidget);
      expect(_startButton(tester, 'Start suite').onPressed, isNotNull);

      // Same label on both variants.
      final labels = find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == 'Label',
      );
      await tester.ensureVisible(labels.at(1));
      await tester.enterText(labels.at(1), 'A');
      await tester.pump();
      expect(find.text('Variant labels must differ'), findsWidgets);
      expect(_startButton(tester, 'Start suite').onPressed, isNull);

      // One variant needs no distinct label.
      await _tap(tester, find.text('One'));
      expect(find.text('Variant 2'), findsNothing);
      expect(_startButton(tester, 'Start suite').onPressed, isNotNull);
    });

    testWidgets(
      'Start sends both variants on the chosen markets, then opens the suite',
      (tester) async {
        final started = fixtureSuites().first;
        SimSuiteConfig? sent;
        final h = await _sheetHost(tester, showNewSuiteSheet);
        h.api.handlers['simSuiteStart'] = (inv) async {
          sent = inv.positionalArguments.first as SimSuiteConfig;
          return started;
        };

        await _type(tester, 'Name', '  Momentum vs defensive ');
        final labels = find.byWidgetPredicate(
          (w) => w is TextField && w.decoration?.labelText == 'Label',
        );
        await tester.ensureVisible(labels.at(0));
        await tester.enterText(labels.at(0), 'Momentum');
        await tester.ensureVisible(labels.at(1));
        await tester.enterText(labels.at(1), 'Defensive');
        final strategies = find.byWidgetPredicate(
          (w) => w is TextField && w.decoration?.labelText == 'Strategy',
        );
        await tester.ensureVisible(strategies.at(1));
        await tester.enterText(strategies.at(1), 'Hold more cash.');
        await _tap(tester, find.text('Historical'));
        await tester.ensureVisible(find.text('Start suite'));
        await tester.tap(find.text('Start suite'));
        await settle(tester);

        final c = sent!;
        expect(c.name, 'Momentum vs defensive');
        expect(c.scenarios, ['volmageddon-2018', 'q4-selloff-2018']);
        expect(c.scenarioMode, ScenarioMode.historical);
        expect(c.bootstrapRuns, 0);
        expect(c.startingCash, 1200);
        expect(c.cyclesPerDay, 2);
        expect(c.variants.map((v) => v.label), ['Momentum', 'Defensive']);
        expect(c.variants.map((v) => v.model), [
          SimModel.main,
          SimModel.subagent,
        ]);
        expect(c.variants[0].strategy, isNull);
        expect(c.variants[1].strategy, 'Hold more cash.');
        expect(c.watchlist, defaultSettings.watchlist);

        expect(find.byType(SuitePage), findsOneWidget);
        expect(
          tester.widget<SuitePage>(find.byType(SuitePage)).suiteId,
          started.id,
        );
        expect(find.text('Suite started'), findsOneWidget);
      },
    );

    testWidgets('a server refusal keeps the form open with the message', (
      tester,
    ) async {
      final h = await _sheetHost(tester, showNewSuiteSheet);
      h.api.fail(
        'simSuiteStart',
        const ApiError(400, 'Too many runs for one suite'),
      );
      await _type(tester, 'Name', 'Big one');

      await tester.ensureVisible(find.text('Start suite'));
      await tester.tap(find.text('Start suite'));
      await settle(tester);

      expect(find.text('Too many runs for one suite'), findsOneWidget);
      expect(find.byType(SuitePage), findsNothing);
      expect(_startButton(tester, 'Start suite').onPressed, isNotNull);
    });
  });
}
