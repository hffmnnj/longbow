import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/api/harness_api.dart';
import 'package:longbow/features/performance/performance_screen.dart';
import 'package:longbow/features/reports/report_page.dart';
import 'package:longbow/features/symbol/symbol_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

PerformanceSummary _performance() => PerformanceSummary.fromJson(
      jsonDecode(File('test/fixtures/performance.json').readAsStringSync())
          as Map<String, dynamic>,
    );

Map<String, dynamic> _performanceJson() =>
    jsonDecode(File('test/fixtures/performance.json').readAsStringSync())
        as Map<String, dynamic>;

/// A harness whose performance endpoint answers from the synthetic fixture.
Future<StoreHarness> _ready(
  WidgetTester tester, {
  PerformanceSummary Function()? performance,
  List<ReportSummary> reports = const [],
}) async {
  final harness = await StoreHarness.create();
  harness.api.on('performance', () async => performance?.call() ?? _performance());
  harness.api.on('reports', () async => reports);
  await tester.runAsync(harness.start);
  return harness;
}

Future<void> _pumpLoaded(WidgetTester tester, StoreHarness harness) async {
  await pumpScreen(tester, const PerformanceScreen(), harness: harness);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('performance_statStrip', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    expect(find.text('REALIZED P&L'), findsOneWidget);
    expect(find.text('\u2212\$521.12'), findsOneWidget);
    expect(find.text('6 closed trades'), findsOneWidget);
    expect(find.text('WIN RATE'), findsOneWidget);
    expect(find.text('0.00%'), findsOneWidget);
    expect(find.text('AVERAGE R'), findsOneWidget);
    expect(find.text('EXPECTANCY'), findsOneWidget);
    expect(find.text('\u2212\$65.14'), findsOneWidget);
    expect(find.text('PROFIT FACTOR'), findsOneWidget);
    expect(find.text('AVG HOLDING'), findsOneWidget);
  });

  testWidgets('performance_tradesList', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    // Newest first with signed P&L, source chips, and the plan caveat.
    expect(find.text('VRT'), findsOneWidget);
    expect(find.text('AVGO'), findsNWidgets(2));
    expect(find.text('\u2212\$53.84'), findsOneWidget);
    expect(find.text('Robinhood history'), findsNWidgets(6));
    expect(
      find.text(
        'Newest first. Older trades come from Robinhood\'s own history and carry no plan, so they have no R multiple.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('performance_empty', (tester) async {
    final harness = await _ready(
      tester,
      performance: () => const PerformanceSummary(
        trades: [],
        realizedPnl: 0,
        calibration: [],
        exposure: [],
        sectors: [],
        ordersByStatus: {},
      ),
    );
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    expect(find.text('No closed trades yet'), findsWidgets);
    expect(find.text('Overview'), findsNothing);
  });

  testWidgets('performance_robinhoodTradeOpensSymbol', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    await tester.scrollUntilVisible(
      find.text('VRT'),
      300,
      scrollable: find.byWidgetPredicate(
        (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
      ),
    );
    // Let the ensureVisible animation finish so the row is hittable.
    await tester.pumpAndSettle();
    await tester.tap(find.text('VRT'));
    // SymbolPage keeps live content animating; settle is not expected there.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.byType(SymbolPage), findsOneWidget);
  });

  testWidgets('performance_harnessTradeOpensReport', (tester) async {
    final harness = await _ready(
      tester,
      performance: () => const PerformanceSummary(
        trades: [
          ClosedTrade(
            symbol: 'HOLO',
            closedAt: 2,
            quantity: 1,
            exitPrice: 10,
            pnl: 5,
            source: TradeSource.harness,
          ),
        ],
        realizedPnl: 5,
        calibration: [],
        exposure: [],
        sectors: [],
        ordersByStatus: {},
      ),
      reports: const [
        ReportSummary(
          id: 'r1',
          kind: ReportKind.trade,
          at: 1,
          symbol: 'HOLO',
          periodStart: '2026-10-20',
          periodEnd: '2026-10-21',
          headline: 'h',
        ),
      ],
    );
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    await tester.scrollUntilVisible(
      find.text('HOLO'),
      300,
      scrollable: find.byWidgetPredicate(
        (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
      ),
    );
    // Let the ensureVisible animation finish so the row is hittable.
    await tester.pumpAndSettle();
    await tester.tap(find.text('HOLO'));
    await tester.pumpAndSettle();
    expect(find.byType(ReportPage), findsOneWidget);
  });

  testWidgets('performance_calibrationReading', (tester) async {
    final map = _performanceJson();
    map['calibration'] = [
      {'from': 0.5, 'to': 0.6, 'predicted': 0.55, 'realized': 0.4, 'count': 10},
    ];
    map['brier'] = 0.083;
    final harness = await _ready(
      tester,
      performance: () => PerformanceSummary.fromJson(map),
    );
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    expect(
      find.text('Realized win rate runs 15 points below predictions across 10 trades'),
      findsOneWidget,
    );
    expect(find.text('50\u201360%'), findsOneWidget);
    expect(
      find.text('Brier score 0.083 (0 is perfect, 0.25 is a coin flip)'),
      findsOneWidget,
    );
  });

  testWidgets('performance_exposureAndHeat', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    expect(find.text('ADBE'), findsOneWidget);
    expect(find.text('+5.29%'), findsOneWidget);
    expect(find.text('stop \$327.19'), findsOneWidget);
    expect(find.text('risk \u22120.18%'), findsOneWidget);
    expect(find.text('Heat 2.1% against a 6.0% cap'), findsOneWidget);
    expect(
      find.text('Technology is the largest at 54.6% (cap 60%)'),
      findsOneWidget,
    );
  });

  testWidgets('performance_orderOutcomes', (tester) async {
    final map = _performanceJson();
    map['ordersByStatus'] = {'filled': 3, 'failed': 1, 'pending_approval': 2};
    final harness = await _ready(
      tester,
      performance: () => PerformanceSummary.fromJson(map),
    );
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    expect(find.text('6 orders proposed, 3 filled'), findsOneWidget);
    expect(find.text('Filled'), findsOneWidget);
    expect(find.text('Failed'), findsOneWidget);
    expect(find.text('Awaiting approval'), findsOneWidget);
  });

  testWidgets('performance_loadingSkeleton', (tester) async {
    final harness = await StoreHarness.create();
    addTearDown(harness.dispose);
    // Gate the endpoint so the load stays in flight and the skeleton shows.
    harness.api
        .on('performance', () => Completer<PerformanceSummary>().future);
    await pumpScreen(tester, const PerformanceScreen(), harness: harness);

    expect(find.byType(SkeletonBlock), findsWidgets);
  });

  testWidgets('performance_errorAndRetry', (tester) async {
    final harness = await StoreHarness.create();
    harness.api.fail('performance', const ApiError(0, 'boom'));
    await tester.runAsync(harness.start);
    addTearDown(harness.dispose);
    await pumpScreen(tester, const PerformanceScreen(), harness: harness);
    await tester.pumpAndSettle();

    expect(find.text('Retry'), findsWidgets);
    expect(find.textContaining('boom'), findsWidgets);
    await tester.tap(find.text('Retry').first);
    await tester.pumpAndSettle();
    expect(harness.api.count('performance'), greaterThanOrEqualTo(2));
  });

  testWidgets('performance_staleWhileRefreshing', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);
    expect(find.text('VRT'), findsOneWidget);

    harness.api.fail('performance', const ApiError(0, 'stale'));
    await tester.runAsync(() => harness.notifier.loadPerformance(force: true));
    await tester.pump();

    expect(find.text('VRT'), findsOneWidget);
    expect(find.textContaining('Could not refresh'), findsWidgets);
  });

  testWidgets('performance_offlineBanner', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    harness.events.onClose();
    await tester.pump();

    expect(find.textContaining('Offline'), findsOneWidget);
  });

  testWidgets('performance_smallTextScaled', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await pumpScreen(
      tester,
      const PerformanceScreen(),
      harness: harness,
      size: const Size(360, 640),
      textScale: 2.0,
    );
    await tester.pumpAndSettle();

    expect(find.text('REALIZED P&L'), findsOneWidget);
    expect(find.text('VRT'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('performance_wide', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await pumpScreen(
      tester,
      const PerformanceScreen(),
      harness: harness,
      size: const Size(840, 900),
    );
    await tester.pumpAndSettle();

    expect(find.text('REALIZED P&L'), findsOneWidget);
    expect(find.text('VRT'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
