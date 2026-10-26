import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/reports/reports_screen.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

const _daily = ReportSummary(
  id: 'daily-1',
  kind: ReportKind.daily,
  at: 3,
  periodStart: '2026-10-26',
  periodEnd: '2026-10-26',
  headline: 'Daily headline',
  grade: ReportGrade.b,
  pnl: 12.5,
  pnlPct: 0.1,
);

const _weekly = ReportSummary(
  id: 'weekly-1',
  kind: ReportKind.weekly,
  at: 2,
  periodStart: '2026-10-19',
  periodEnd: '2026-10-23',
  headline: 'Weekly headline',
);

const _trade = ReportSummary(
  id: 'trade-1',
  kind: ReportKind.trade,
  at: 1,
  symbol: 'VRT',
  periodStart: '2026-10-19',
  periodEnd: '2026-10-19',
  headline: 'Trade headline',
  grade: ReportGrade.c,
  pnl: -53.84,
);

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 5; i++) {
    await tester.pump();
  }
}

/// Taps a filter segment, first bringing the filter row on screen
/// vertically and the segment on screen horizontally. Segments can be
/// scrolled away in either direction after the list moves.
Future<void> _tapSegment(WidgetTester tester, String label) async {
  final probe = find.text('All');
  for (var i = 0; i < 15; i++) {
    final o = tester.getCenter(probe, warnIfMissed: false);
    if (o.dy >= 120 && o.dy <= 700) break;
    await tester.dragFrom(const Offset(180, 400), const Offset(0, 400));
    await tester.pump();
  }
  final target = find.text(label);
  for (var i = 0; i < 10; i++) {
    final c = tester.getCenter(target, warnIfMissed: false);
    final vVisible = c.dy >= 100 && c.dy <= 740;
    final hVisible = c.dx >= 24 && c.dx <= 336;
    if (vVisible && hVisible) break;
    if (!hVisible) {
      final startY = c.dy.clamp(120.0, 700.0);
      await tester.dragFrom(
        Offset(c.dx.clamp(24.0, 336.0), startY),
        Offset(c.dx < 24 ? 200 : -200, 0),
      );
    } else {
      await tester.dragFrom(const Offset(180, 400), const Offset(0, 400));
    }
    await tester.pump();
  }
  await tester.tap(target);
  await tester.pump();
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
  group('ReportsScreen', () {
    testWidgets('groups by week and filters by kind', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on('reports', () async => [_daily, _weekly, _trade]);
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadReports());
      await pumpScreen(tester, const ReportsScreen(), harness: harness);

      expect(find.text('WEEK OF OCT 26'), findsOneWidget);
      expect(find.text('WEEK OF OCT 19'), findsOneWidget);
      expect(find.text('Daily headline'), findsOneWidget);
      expect(find.text('Weekly headline'), findsOneWidget);
      expect(find.text('Trade headline'), findsOneWidget);
      expect(find.text('3 reports'), findsOneWidget);

      await _tapSegment(tester, 'Trades');
      await _settle(tester);
      await _scrollTo(tester, find.text('Trade headline'));
      await tester.pump();
      expect(find.text('Trade headline'), findsOneWidget);
      expect(find.text('Daily headline'), findsNothing);
      expect(find.text('Weekly headline'), findsNothing);

      await _tapSegment(tester, 'Daily');
      await _settle(tester);
      await _scrollTo(tester, find.text('Daily headline'));
      await tester.pump();
      expect(find.text('Daily headline'), findsOneWidget);
      expect(find.text('Trade headline'), findsNothing);

      await _tapSegment(tester, 'All');
      await _settle(tester);
      await _scrollTo(tester, find.text('Daily headline'), up: true);
      await tester.pump();
      expect(find.text('Daily headline'), findsOneWidget);
      await _scrollTo(tester, find.text('Weekly headline'));
      await tester.pump();
      expect(find.text('Weekly headline'), findsOneWidget);
      await _scrollTo(tester, find.text('Trade headline'));
      await tester.pump();
      expect(find.text('Trade headline'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('shows an empty state when there are no reports',
        (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on('reports', () async => <ReportSummary>[]);
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadReports());
      await pumpScreen(tester, const ReportsScreen(), harness: harness);

      expect(find.text('No reports yet'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('shows an error with Retry, and retries', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.fail('reports', Exception('boom'));
      await tester.runAsync(harness.start);
      await pumpScreen(tester, const ReportsScreen(), harness: harness);
      await _settle(tester);

      expect(find.textContaining('Could not load reports'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await _settle(tester);
      expect(harness.api.count('reports'), 2);
      expect(tester.takeException(), isNull);
    });

    testWidgets('passes at 360x640 with text scale 2.0', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on('reports', () async => [_daily, _weekly, _trade]);
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadReports());
      await pumpScreen(
        tester,
        const ReportsScreen(),
        harness: harness,
        size: const Size(360, 640),
        textScale: 2.0,
      );
      await tester.pump(const Duration(milliseconds: 500));
      await _settle(tester);

      expect(find.text('Daily headline'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('passes at 840x900', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on('reports', () async => [_daily, _weekly, _trade]);
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadReports());
      await pumpScreen(
        tester,
        const ReportsScreen(),
        harness: harness,
        size: const Size(840, 900),
      );
      await tester.pump(const Duration(milliseconds: 500));
      await _settle(tester);
      await _scrollTo(tester, find.text('Trade headline'));
      await tester.pump();

      expect(find.text('Trade headline'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
