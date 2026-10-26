import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/features/feed/transcript_view.dart';
import 'package:longbow/features/lab/lab_widgets.dart';
import 'package:longbow/features/lab/run_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'lab_support.dart';

SimRun _detailed([Map<String, dynamic> patch = const {}]) => fixtureRun({
  'fills': [
    fillJson(symbol: 'MKT', side: 'buy', date: '2031-03-26'),
    fillJson(
      symbol: 'STECH',
      side: 'sell',
      date: '2031-03-28',
      cost: 0.2,
      fees: 0,
    ),
  ],
  'positions': [positionJson('SFIN')],
  ...patch,
});

Future<StoreHarness> _open(
  WidgetTester tester,
  SimRun run, {
  Size size = const Size(360, 800),
  double scale = 1,
}) async {
  final h = await labHarness(tester, runs: [run]);
  await pumpScreen(
    tester,
    RunPage(runId: run.id),
    harness: h,
    size: size,
    textScale: scale,
  );
  await settle(tester);
  return h;
}

void main() {
  group('status handling', () {
    final base = fixtureRun();
    final cases = <({String name, SimRun run, String label, bool canStop})>[
      (
        name: 'queued',
        run: base.copyWith(
          status: SimRunStatus.queued,
          progress: const SimProgress(
            day: 0,
            days: 60,
            cycle: 1,
            cyclesPerDay: 2,
          ),
        ),
        label: 'Queued',
        canStop: true,
      ),
      (
        name: 'running',
        run: base.copyWith(
          status: SimRunStatus.running,
          progress: const SimProgress(
            day: 12,
            days: 60,
            cycle: 2,
            cyclesPerDay: 2,
          ),
        ),
        label: 'Running',
        canStop: true,
      ),
      (name: 'done', run: base, label: 'Done', canStop: false),
      (
        name: 'stopped',
        run: base.copyWith(status: SimRunStatus.stopped),
        label: 'Stopped',
        canStop: false,
      ),
      (
        name: 'failed',
        run: base.copyWith(
          status: SimRunStatus.failed,
          error: 'Model quota exhausted on day 9',
        ),
        label: 'Failed',
        canStop: false,
      ),
    ];
    for (final c in cases) {
      testWidgets(
        '${c.name} run shows its status and ${c.canStop ? 'a Stop action' : 'no Stop action'}',
        (tester) async {
          await _open(tester, c.run);

          expect(find.text(c.label), findsOneWidget);
          expect(find.text('PAPER MONEY'), findsOneWidget);
          expect(
            find.widgetWithText(OutlinedButton, 'Stop'),
            c.canStop ? findsOneWidget : findsNothing,
          );
          expect(
            find.text('Model quota exhausted on day 9'),
            c.name == 'failed' ? findsOneWidget : findsNothing,
          );
          expect(
            find.byType(LabProgress),
            c.canStop ? findsOneWidget : findsNothing,
          );
        },
      );
    }
  });

  testWidgets('stop asks for confirmation and only then stops the run', (
    tester,
  ) async {
    final running = fixtureRun().copyWith(status: SimRunStatus.running);
    final h = await _open(tester, running);
    h.api.on(
      'simStop',
      () async => running.copyWith(status: SimRunStatus.stopped),
    );

    await tester.tap(find.widgetWithText(OutlinedButton, 'Stop'));
    await settle(tester);
    expect(find.text('Stop this simulation?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    expect(h.api.count('simStop'), 0);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Stop'));
    await settle(tester);
    await tester.tap(find.text('Stop run'));
    await settle(tester);

    expect(h.api.count('simStop'), 1);
    expect(h.simStore.run(running.id)!.status, SimRunStatus.stopped);
    expect(find.widgetWithText(OutlinedButton, 'Stop'), findsNothing);
    expect(find.text('Stopped'), findsOneWidget);
  });

  testWidgets(
    'overview shows the equity chart against SPY and grouped metrics',
    (tester) async {
      final run = _detailed({
        'metrics': {
          ...(fixtureRunJson()['metrics'] as Map<String, dynamic>),
          'riskBlocks': {'sector': 3, 'max_positions': 1},
        },
      });
      await _open(tester, run);

      expect(find.byType(DitherAreaChart), findsOneWidget);
      expect(find.text('EQUITY AGAINST SPY'), findsOneWidget);
      expect(
        find.textContaining('Returned 0.00% against SPY +8.71%'),
        findsOneWidget,
      );
      expect(find.text('RETURN AND RISK'), findsOneWidget);
      expect(find.text('TRADING'), findsOneWidget);
      expect(find.text('COSTS'), findsOneWidget);
      expect(find.text('Max drawdown'), findsOneWidget);
      expect(find.text('Costs paid'), findsOneWidget);
      // Risk blocks render as one bar per rule, biggest first.
      expect(find.text('Risk blocks'), findsOneWidget);
      expect(find.byType(BarStrip), findsNWidgets(2));
      expect(find.text('sector'), findsOneWidget);
      expect(find.text('max_positions'), findsOneWidget);
    },
  );

  testWidgets('a run with no closes says so and has no metrics yet', (
    tester,
  ) async {
    final run = fixtureRun({
      'status': 'running',
      'equity': <Object>[],
      'metrics': null,
      'progress': {'day': 0, 'days': 60, 'cycle': 1, 'cyclesPerDay': 2},
    });
    await _open(tester, run);

    expect(find.text('Waiting for the first close'), findsOneWidget);
    expect(find.byType(DitherAreaChart), findsNothing);
    expect(
      find.text('No metrics yet. They appear after the first close.'),
      findsOneWidget,
    );
  });

  testWidgets(
    'trades lists fills with their costs and fees, newest first, and open positions',
    (tester) async {
      await _open(tester, _detailed());
      await tester.tap(find.text('Trades'));
      await settle(tester);

      expect(find.text('FILLS · 2'), findsOneWidget);
      // Newest fill first: the sell on Mar 28 comes before the buy on Mar 26.
      final sellY = tester.getTopLeft(find.text('STECH')).dy;
      final buyY = tester.getTopLeft(find.text('MKT')).dy;
      expect(sellY, lessThan(buyY));
      expect(find.text('Mar 28 · costs \$0.20'), findsOneWidget);
      expect(
        find.text('Mar 26 · costs \$0.06 incl. \$0.01 fees'),
        findsOneWidget,
      );
      expect(find.text('2 @ \$500.00'), findsNWidgets(2));
      expect(find.text('POSITIONS · 1'), findsOneWidget);
      expect(find.text('SFIN'), findsOneWidget);
      expect(find.text('DECISIONS · 0'), findsOneWidget);
      expect(find.text('ORDERS · 0'), findsOneWidget);
    },
  );

  testWidgets(
    'blind symbols stay aliased until the run is over, then Reveal swaps in the real tickers',
    (tester) async {
      await _open(tester, _detailed());
      await tester.tap(find.text('Trades'));
      await settle(tester);
      expect(find.text('MKT'), findsOneWidget);
      expect(find.text('SPY'), findsNothing);

      await tester.tap(find.text('Reveal tickers'));
      await settle(tester);

      expect(find.text('SPY'), findsOneWidget);
      expect(find.text('XLK'), findsOneWidget); // STECH
      expect(find.text('XLF'), findsOneWidget); // SFIN
      expect(find.text('MKT'), findsNothing);

      await tester.tap(find.text('Reveal tickers'));
      await settle(tester);
      expect(find.text('MKT'), findsOneWidget);
    },
  );

  testWidgets('a running blind run offers no reveal and explains why', (
    tester,
  ) async {
    final live = fixtureRun({
      'status': 'running',
      'aliases': null,
      'fills': [fillJson()],
    });
    await _open(tester, live);

    expect(find.text('Reveal tickers'), findsNothing);
    expect(
      find.textContaining('Tickers stay aliased until the run ends'),
      findsOneWidget,
    );
  });

  testWidgets('a historical run shows real tickers and no reveal toggle', (
    tester,
  ) async {
    final run = fixtureRun({
      'config': {
        'mode': 'historical',
        'startDate': '2024-03-01',
        'days': 60,
        'startingCash': 1200,
        'cyclesPerDay': 2,
        'name': 'Real days',
      },
      'aliases': null,
      'fills': [fillJson(symbol: 'NVDA')],
    });
    await _open(tester, run);
    await tester.tap(find.text('Trades'));
    await settle(tester);

    expect(find.text('NVDA'), findsOneWidget);
    expect(find.text('Reveal tickers'), findsNothing);
    expect(find.text('Real days'), findsOneWidget);
  });

  testWidgets(
    'agent tab shows the transcript view for this run, wired to the sim store',
    (tester) async {
      final h = await labHarness(tester, runs: [fixtureRun()]);
      h.api.on(
        'simMessages',
        () async => [testMessage('m1', text: 'Opening check: stay flat.')],
      );
      await pumpScreen(tester, RunPage(runId: fixtureRun().id), harness: h);
      await settle(tester);
      await tester.tap(find.text('Agent'));
      await settle(tester);
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await settle(tester);

      final view = tester.widget<FeedTranscriptView>(
        find.byType(FeedTranscriptView),
      );
      expect(view.simRunId, fixtureRun().id);
      expect(view.feed.messages.map((m) => m.id), ['m1']);
    },
  );

  testWidgets('an agent that said nothing shows an empty state', (
    tester,
  ) async {
    await _open(tester, fixtureRun());
    await tester.tap(find.text('Agent'));
    await settle(tester);
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
    await settle(tester);

    expect(find.text('This run has no agent messages'), findsOneWidget);
  });

  testWidgets('an unknown run id says the run was not found', (tester) async {
    final h = await labHarness(tester);
    await pumpScreen(tester, const RunPage(runId: 'nope'), harness: h);
    await settle(tester);

    expect(find.text('Run not found'), findsOneWidget);
  });
}
