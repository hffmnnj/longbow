import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/reports/report_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

Map<String, dynamic> _fixtureMap(String name) =>
    jsonDecode(File('test/fixtures/$name.json').readAsStringSync())
        as Map<String, dynamic>;

Report _dailyReport() => Report(
  id: 'daily-1',
  kind: ReportKind.daily,
  at: 1792978653000,
  periodStart: '2026-10-26',
  periodEnd: '2026-10-26',
  headline: 'Quiet day: account up 1.00% against SPY',
  grade: ReportGrade.b,
  pnl: 120.0,
  pnlPct: 1.0,
  narrative: const ReportNarrative(
    kind: ReportKind.daily,
    headline: 'Quiet day: account up 1.00% against SPY',
    summary: 'A calm session summary.',
    grade: ReportGrade.b,
    gradeReason: 'Sized well, no churn.',
    sections: [ReportSection(title: 'Market', body: 'Markets drifted.')],
    lessons: ['Patience paid.'],
    nextSteps: ['Watch NVDA.'],
  ),
  facts: ReportFacts(
    periodStart: '2026-10-26',
    periodEnd: '2026-10-26',
    pnl: 120.0,
    pnlPct: 1.0,
    benchmarkPct: 0.6,
    equityCurve: const [
      HoldingsReplayPoint(date: '2026-10-24', value: 11900),
      HoldingsReplayPoint(date: '2026-10-25', value: 11960),
      HoldingsReplayPoint(date: '2026-10-26', value: 12020),
    ],
    trades: [
      ClosedTrade(
        symbol: 'SPY',
        closedAt: 1792920000000,
        quantity: 1,
        exitPrice: 600,
        pnl: 50,
        pnlPct: 0.5,
        fees: 1.02,
        rMultiple: 1.5,
        source: TradeSource.harness,
      ),
    ],
    realizedPnl: 50,
    winRatePct: 100,
    avgR: 1.5,
    orders: const ReportOrderCounts(
      submitted: 2,
      filled: 1,
      rejected: 1,
      cancelled: 0,
      failed: 0,
    ),
    positions: const [
      ReportPosition(symbol: 'SPY', weightPct: 20, unrealizedPnl: 100),
      ReportPosition(symbol: 'QQQ', weightPct: 10, unrealizedPnl: -20),
    ],
    heatPct: 2,
    decisions: const [
      ReportDecision(
        id: 'd1',
        at: 1792920000000,
        action: JournalAction.buy,
        symbol: 'SPY',
        summary: 'Bought SPY',
      ),
    ],
  ),
);

Future<void> _settle(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 500));
  for (var i = 0; i < 5; i++) {
    await tester.pump();
  }
}

/// Drags the page until [target] is built (sliver lists build lazily), so
/// assertions see below-the-fold content. Pass [up] to drag back toward the
/// top: items scrolled far past are unmounted again.
Future<void> _scrollTo(
  WidgetTester tester,
  Finder target, {
  bool up = false,
}) async {
  for (var i = 0; i < 30 && target.evaluate().isEmpty; i++) {
    await tester.drag(
      find.byType(CustomScrollView),
      Offset(0, up ? 400 : -400),
    );
    await tester.pump();
  }
}

void main() {
  group('ReportPage', () {
    testWidgets('trade report shows price path, plan table and narrative',
        (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      final report = Report.fromJson(_fixtureMap('report_daily'));
      harness.api.on('report', () async => report);
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadReport(report.id));
      await pumpScreen(tester, ReportPage(id: report.id), harness: harness);
      await _settle(tester);

      expect(find.text(report.headline), findsOneWidget);
      expect(find.text('C'), findsOneWidget);
      expect(find.textContaining('Provisional C:'), findsOneWidget);
      expect(find.text('SPY'), findsWidgets);
      await _scrollTo(tester, find.text('PRICE PATH'));
      await tester.pump();
      expect(find.text('PRICE PATH'), findsOneWidget);
      await _scrollTo(tester, find.text('PLAN VERSUS OUTCOME'));
      await tester.pump();
      expect(find.text('PLAN VERSUS OUTCOME'), findsOneWidget);
      expect(find.text('Realized P&L'), findsOneWidget);
      await _scrollTo(tester, find.text('NEXT'));
      await tester.pump();
      expect(find.text('NEXT'), findsOneWidget);
      await _scrollTo(
        tester,
        find.textContaining('Grade the decision process separately from'),
        up: true,
      );
      await tester.pump();
      expect(
        find.textContaining('Grade the decision process separately from'),
        findsOneWidget,
      );
      await _scrollTo(
        tester,
        find.textContaining('Record the rationale'),
      );
      await tester.pump();
      expect(
        find.textContaining('Record the rationale'),
        findsOneWidget,
      );
      expect(
        find.byTooltip('Share report'),
        findsOneWidget,
      );
      expect(find.byTooltip('Print report'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('daily report shows equity, trades, positions and decisions',
        (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      final report = _dailyReport();
      harness.api.on('report', () async => report);
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadReport(report.id));
      await pumpScreen(tester, ReportPage(id: report.id), harness: harness);
      await _settle(tester);

      expect(find.text(report.headline), findsOneWidget);
      expect(find.text('DECISION GRADE'), findsOneWidget);
      expect(find.text('Sized well, no churn.'), findsOneWidget);
      await _scrollTo(tester, find.text('DAY MOVE VERSUS SPY'));
      await tester.pump();
      expect(find.text('DAY MOVE VERSUS SPY'), findsOneWidget);
      await _scrollTo(tester, find.text('CLOSED TRADES'));
      await tester.pump();
      expect(find.text('CLOSED TRADES'), findsOneWidget);
      await _scrollTo(
        tester,
        find.text('POSITIONS AT THE END OF THE PERIOD'),
      );
      await tester.pump();
      expect(find.text('POSITIONS AT THE END OF THE PERIOD'), findsOneWidget);
      await _scrollTo(tester, find.text('ORDERS'));
      await tester.pump();
      expect(find.text('ORDERS'), findsOneWidget);
      await _scrollTo(tester, find.text('DECISIONS'));
      await tester.pump();
      expect(find.text('DECISIONS'), findsOneWidget);
      expect(find.text('Bought SPY'), findsOneWidget);
      await _scrollTo(tester, find.text('Market'));
      await tester.pump();
      expect(find.text('Market'), findsOneWidget);
      await _scrollTo(tester, find.text('Patience paid.'));
      await tester.pump();
      expect(find.text('Patience paid.'), findsOneWidget);
      await _scrollTo(tester, find.text('Watch NVDA.'));
      await tester.pump();
      expect(find.text('Watch NVDA.'), findsOneWidget);
      expect(find.text('PRICE PATH'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('shows an error with Retry, and retries', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.fail('report', Exception('boom'));
      await tester.runAsync(harness.start);
      await pumpScreen(tester, const ReportPage(id: 'missing'), harness: harness);
      await _settle(tester);

      expect(find.text('Something went wrong'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await _settle(tester);
      expect(harness.api.count('report'), 2);
      expect(tester.takeException(), isNull);
    });

    testWidgets('passes at 360x640 with text scale 2.0', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      final report = Report.fromJson(_fixtureMap('report_daily'));
      harness.api.on('report', () async => report);
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadReport(report.id));
      await pumpScreen(
        tester,
        ReportPage(id: report.id),
        harness: harness,
        size: const Size(360, 640),
        textScale: 2.0,
      );
      await _settle(tester);

      expect(find.text(report.headline), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('passes at 840x900', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on('report', () async => _dailyReport());
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadReport('daily-1'));
      await pumpScreen(
        tester,
        const ReportPage(id: 'daily-1'),
        harness: harness,
        size: const Size(840, 900),
      );
      await _settle(tester);

      await _scrollTo(tester, find.text('CLOSED TRADES'));
      await tester.pump();
      expect(find.text('CLOSED TRADES'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
