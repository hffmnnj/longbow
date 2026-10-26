import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/feed/order_card.dart';
import 'package:longbow/features/history/history_screen.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

List<dynamic> _fixtureList(String name) =>
    jsonDecode(File('test/fixtures/$name.json').readAsStringSync())
        as List<dynamic>;

Future<void> _settle(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 300));
  for (var i = 0; i < 5; i++) {
    await tester.pump();
  }
}

/// Drags a filter row left so the last segment (Trades/Rejected) is on
/// screen: [LbSegmented] scrolls horizontally when its options do not fit.
Future<void> _revealLastSegment(WidgetTester tester) async {
  await tester.drag(find.text('All').first, const Offset(-240, 0));
  await tester.pump();
}

/// Drags the page until [target] is built (sliver lists build lazily), so
/// assertions see below-the-fold content.
Future<void> _scrollTo(WidgetTester tester, Finder target) async {
  for (var i = 0; i < 30 && target.evaluate().isEmpty; i++) {
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -400));
    await tester.pump();
  }
}

void main() {
  group('HistoryScreen', () {
    testWidgets('journal lists newest first with action and symbol filters',
        (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on(
        'journal',
        () async => [testEntry('older', at: 1), testEntry('newer', at: 2)],
      );
      await tester.runAsync(harness.start);
      await pumpScreen(tester, const HistoryScreen(), harness: harness);
      await _settle(tester);

      final newerDy = tester.getTopLeft(find.text('newer')).dy;
      final olderDy = tester.getTopLeft(find.text('older')).dy;
      expect(newerDy, lessThan(olderDy));

      await tester.tap(find.text('Buy'));
      await _settle(tester);
      expect(find.text('No entries match'), findsOneWidget);
      expect(find.text('older'), findsNothing);

      await tester.tap(find.text('Clear filters'));
      await _settle(tester);
      expect(find.text('newer'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'zzz');
      await _settle(tester);
      expect(find.text('No entries match'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('journal shows fixture entries', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on(
        'journal',
        () async => [
          for (final j in _fixtureList('journal'))
            JournalEntry.fromJson(j as Map<String, dynamic>),
        ],
      );
      await tester.runAsync(harness.start);
      await pumpScreen(tester, const HistoryScreen(), harness: harness);
      await _settle(tester);

      expect(
        find.text(
          'Quick status check: hold all positions, no new entries this cycle',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('orders tab filters by status', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on(
        'orders',
        () async => [
          for (final j in _fixtureList('orders'))
            OrderRecord.fromJson(j as Map<String, dynamic>),
          testOrder('o-filled', status: OrderStatus.filled),
          testOrder('o-rej', status: OrderStatus.rejectedUser),
        ],
      );
      await tester.runAsync(harness.start);
      await pumpScreen(tester, const HistoryScreen(), harness: harness);
      await _settle(tester);

      await tester.tap(find.text('Orders'));
      await _settle(tester);
      expect(find.byType(OrderCard), findsWidgets);

      await tester.tap(find.text('Filled').first);
      await _settle(tester);
      await _scrollTo(tester, find.byType(OrderCard));
      await tester.pump();
      expect(find.byType(OrderCard), findsOneWidget);
      expect(find.text('Awaiting approval'), findsNothing);
      expect(
        find.descendant(
          of: find.byType(OrderCard),
          matching: find.text('Filled'),
        ),
        findsOneWidget,
      );

      await tester.tap(find.text('Open'));
      await _settle(tester);
      await _scrollTo(tester, find.byType(OrderCard));
      await tester.pump();
      expect(find.byType(OrderCard), findsOneWidget);
      expect(find.text('Awaiting approval'), findsOneWidget);

      await _revealLastSegment(tester);
      await tester.tap(find.text('Rejected').first);
      await _settle(tester);
      await _scrollTo(tester, find.byType(OrderCard));
      await tester.pump();
      expect(find.byType(OrderCard), findsOneWidget);
      expect(find.text('Awaiting approval'), findsNothing);
      expect(
        find.descendant(
          of: find.byType(OrderCard),
          matching: find.text('Rejected'),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('notes tab groups by folder with size and time',
        (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on(
        'notes',
        () async => [
          for (final j in _fixtureList('notes'))
            NoteFile.fromJson(j as Map<String, dynamic>),
        ],
      );
      await tester.runAsync(harness.start);
      await pumpScreen(tester, const HistoryScreen(), harness: harness);
      await _settle(tester);

      await tester.tap(find.text('Notes'));
      await _settle(tester);
      expect(find.text('GENERAL'), findsOneWidget);
      expect(find.text('THESES'), findsOneWidget);
      expect(find.text('NVDA'), findsOneWidget);
      expect(find.text('plan'), findsOneWidget);
      expect(find.text('9.1 KB'), findsOneWidget);
      expect(find.textContaining('Updated'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('skills tab lists names and descriptions', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on(
        'skills',
        () async => [
          for (final j in _fixtureList('skills'))
            SkillSummary.fromJson(j as Map<String, dynamic>),
        ],
      );
      await tester.runAsync(harness.start);
      await pumpScreen(tester, const HistoryScreen(), harness: harness);
      await _settle(tester);

      await tester.tap(find.text('Skills'));
      await _settle(tester);
      expect(find.text('market-regime'), findsOneWidget);
      expect(
        find.text(
          'Classifies the market trend and volatility regime from SPY, QQQ, VIX, and yields; load at the start of every cycle to set exposure and allowed setups.',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('offline shows a stale banner', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      await tester.runAsync(harness.start);
      await pumpScreen(tester, const HistoryScreen(), harness: harness);
      await _settle(tester);

      harness.events.onClose();
      await _settle(tester);
      expect(find.textContaining('Offline'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('passes at 360x640 with text scale 2.0', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on(
        'notes',
        () async => [
          for (final j in _fixtureList('notes'))
            NoteFile.fromJson(j as Map<String, dynamic>),
        ],
      );
      await tester.runAsync(harness.start);
      await pumpScreen(
        tester,
        const HistoryScreen(),
        harness: harness,
        size: const Size(360, 640),
        textScale: 2.0,
      );
      await _settle(tester);

      await tester.tap(find.text('Notes'));
      await _settle(tester);
      await _scrollTo(tester, find.text('NVDA'));
      await tester.pump();
      expect(find.text('NVDA'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('passes at 840x900', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      await tester.runAsync(harness.start);
      await pumpScreen(
        tester,
        const HistoryScreen(),
        harness: harness,
        size: const Size(840, 900),
      );
      await _settle(tester);

      await tester.tap(find.text('Orders'));
      await _settle(tester);
      expect(find.text('Open'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
