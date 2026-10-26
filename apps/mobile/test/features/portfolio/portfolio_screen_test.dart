import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/domain/analytics_calc.dart' show replayLabel, replayNote;
import 'package:longbow/features/feed/order_card.dart';
import 'package:longbow/features/portfolio/allocation_panel.dart';
import 'package:longbow/features/portfolio/equity_hero.dart';
import 'package:longbow/features/portfolio/portfolio_screen.dart';
import 'package:longbow/features/portfolio/positions_panel.dart';
import 'package:longbow/features/reports/report_page.dart';
import 'package:longbow/features/symbol/symbol_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'portfolio_test_data.dart';

Future<void> pumpPortfolio(
  WidgetTester tester,
  StoreHarness h, {
  Size size = const Size(360, 800),
  double textScale = 1,
  VoidCallback? onSeeAll,
}) async {
  await pumpScreen(tester, PortfolioScreen(onSeeAllOrders: onSeeAll), harness: h, size: size, textScale: textScale);
  await settle(tester);
}

TextStyle? styleOf(WidgetTester tester, Finder f) => tester.widget<Text>(f.first).style;

StatusResponse withDay(double? pnl, double? pctDay) {
  final s = fixtureStatus();
  return StatusResponse(
    agent: s.agent,
    broker: s.broker,
    market: s.market,
    settings: s.settings,
    account: s.account,
    halts: s.halts,
    dayPnl: pnl,
    dayPnlPct: pctDay,
    liveTrading: s.liveTrading,
    models: s.models,
  );
}

void main() {
  group('hero', () {
    testWidgets('shows equity, cash and buying power, and a losing day in the loss colour', (tester) async {
      final h = await openHarness(tester); // fixture: equity 9835.17, day -2.62 (-0.0266%)
      await pumpPortfolio(tester, h);

      expect(find.text('\$9,835.17'), findsOneWidget);
      expect(find.text('\$2,967.92'), findsNWidgets(2)); // cash and buying power are equal in the fixture
      final day = find.textContaining('$kMinus\$2.62');
      expect(day, findsOneWidget);
      expect(find.textContaining('(${kMinus}0.03%)'), findsOneWidget);
      expect(styleOf(tester, day)?.color, LongbowColors.dark.loss);
    });

    testWidgets('a winning day is green with a plus sign', (tester) async {
      final h = await openHarness(tester, status: withDay(41.5, 0.42));
      await pumpPortfolio(tester, h);

      final day = find.textContaining('+\$41.50');
      expect(day, findsOneWidget);
      expect(find.textContaining('(+0.42%)'), findsOneWidget);
      expect(styleOf(tester, day)?.color, LongbowColors.dark.gain);
    });

    testWidgets('without a day result it says so instead of showing zero', (tester) async {
      final h = await openHarness(tester, status: withDay(null, null));
      await pumpPortfolio(tester, h);

      expect(find.byWidgetPredicate((w) => w is Text && w.data == '\u2014'), findsWidgets);
      expect(find.textContaining('\$0.00'), findsNothing);
    });

    testWidgets('the equity number rolls to a new value', (tester) async {
      final h = await openHarness(tester);
      await pumpPortfolio(tester, h);
      final s = fixtureStatus();
      h.api.on('status', () async => s.copyWith(account: AccountSnapshot(at: s.account!.at + 1000, equity: 10000, cash: 1, buyingPower: 1, positions: const [])));
      await tester.runAsync(h.notifier.refreshStatus);
      await tester.pump(); // the animation starts on the first frame
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('\$9,835.17'), findsNothing);
      expect(find.text('\$10,000.00'), findsNothing); // mid-roll
      await settle(tester);
      expect(find.text('\$10,000.00'), findsOneWidget);
    });

    testWidgets('a failed status load shows an error and Retry reloads it', (tester) async {
      final h = await openHarness(tester, configure: (api) => api.fail('status', StateError('no route')));
      await pumpPortfolio(tester, h);

      expect(find.text('Could not load the account'), findsOneWidget);
      expect(find.text('no route'), findsOneWidget);
      final before = h.api.count('status');
      h.api.on('status', () async => fixtureStatus());
      await tester.tap(find.widgetWithText(OutlinedButton, 'Retry'));
      await tester.runAsync(h.pump);
      await settle(tester);

      expect(h.api.count('status'), greaterThan(before));
      expect(find.text('\$9,835.17'), findsOneWidget);
    });

    testWidgets('before the account arrives a skeleton fills the hero and no number', (tester) async {
      final gate = Completer<StatusResponse>();
      final h = await openHarness(tester, configure: (api) => api.on('status', () => gate.future));
      await tester.runAsync(h.start);
      await pumpScreen(tester, const PortfolioScreen(), harness: h);
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.byType(SkeletonBlock), findsWidgets);
      expect(tester.getSize(find.byType(SkeletonBlock).first).height, heroSkeletonHeight);
      expect(find.textContaining('\$9,835'), findsNothing);
    });
  });

  group('equity chart', () {
    testWidgets('reads the fixture return against SPY in plain words', (tester) async {
      final h = await openHarness(tester); // returns -0.0306% vs SPY 0%
      await pumpPortfolio(tester, h);

      expect(find.text('EQUITY VS SPY'), findsOneWidget);
      expect(find.textContaining('Down 0.03% since Oct 24, level with SPY'), findsOneWidget);
      expect(find.textContaining('max drawdown 0.03%'), findsOneWidget);
    });

    testWidgets('says ahead of SPY when the account beat it', (tester) async {
      final h = await openHarness(tester, equity: equityWith(returnPct: 3.2, benchmarkReturnPct: 2.1));
      await pumpPortfolio(tester, h);

      expect(find.textContaining('Up 3.2% since Oct 1, 1.1 points ahead of SPY'), findsOneWidget);
    });

    testWidgets('the replay toggle shows the replay reading and the not-real-history note', (tester) async {
      final h = await openHarness(tester); // fixture has six replay days
      await pumpPortfolio(tester, h);

      expect(find.text(replayNote), findsNothing);
      await tester.tap(find.text('Replay'));
      await settle(tester);

      expect(find.text(replayLabel.toUpperCase()), findsOneWidget);
      expect(find.text(replayNote), findsOneWidget);
      expect(find.textContaining("Replay: today's holdings are ${kMinus}0.62% since Oct 16"), findsOneWidget);
    });

    testWidgets('switching range requests it, keeps the old chart visible and then swaps in the new one', (tester) async {
      final gate = Completer<EquityHistory>();
      final seen = <AnalyticsRange>[];
      final h = await openHarness(tester, configure: (api) {
        api.handlers['equity'] = (inv) {
          final r = inv.positionalArguments.first as AnalyticsRange;
          seen.add(r);
          return r == AnalyticsRange.oneYear ? gate.future : Future.value(equityWith(returnPct: 3.2, benchmarkReturnPct: 2.1));
        };
      });
      await pumpPortfolio(tester, h);
      expect(seen, [AnalyticsRange.threeMonths]);

      await tester.tap(find.text('1Y'));
      await settle(tester);

      expect(seen, [AnalyticsRange.threeMonths, AnalyticsRange.oneYear]);
      expect(find.textContaining('Up 3.2% since Oct 1'), findsOneWidget); // old data still on screen
      expect(find.text('Loading 1Y\u2026'), findsOneWidget);

      gate.complete(equityWith(returnPct: 8, benchmarkReturnPct: 9.5));
      await tester.runAsync(h.pump);
      await settle(tester);

      expect(find.textContaining('Up 8.0% since Oct 1, 1.5 points behind SPY'), findsOneWidget);
      expect(find.textContaining('Up 3.2%'), findsNothing);
      expect(find.text('Loading 1Y\u2026'), findsNothing);
    });

    testWidgets('a failed range shows an error with Retry', (tester) async {
      final h = await openHarness(tester, configure: (api) => api.fail('equity', StateError('timeout')));
      await pumpPortfolio(tester, h);

      expect(find.textContaining('timeout'), findsOneWidget);
      final before = h.api.count('equity');
      h.api.on('equity', () async => equityWith(returnPct: 1.2));
      await tester.tap(find.widgetWithText(OutlinedButton, 'Retry'));
      await tester.runAsync(h.pump);
      await settle(tester);

      expect(h.api.count('equity'), before + 1);
      expect(find.textContaining('Up 1.2% since Oct 1'), findsOneWidget);
    });
  });

  group('positions and allocation', () {
    testWidgets('lists positions by market value with stop distance and weight', (tester) async {
      final h = await openHarness(tester);
      await pumpPortfolio(tester, h);

      final order = [for (final w in tester.widgetList<PositionRow>(find.byType(PositionRow))) w.row.position.symbol];
      expect(order, ['NVDA', 'ASML', 'AAPL', 'XLV', 'META', 'CRM', 'ADBE', 'GOOGL']);
      expect(find.text('8 held, 66.05% of equity invested'), findsOneWidget);

      final nvda = find.byWidgetPredicate((w) => w is PositionRow && w.row.position.symbol == 'NVDA');
      // price 1412.05 / 6.6638 = 211.89; stop 200.63 -> (211.89-200.63)/211.89 = 5.32% above
      expect(find.descendant(of: nvda, matching: find.text('5.32% above')), findsOneWidget);
      expect(find.descendant(of: nvda, matching: find.text('To stop \$200.63')), findsOneWidget);
      expect(find.descendant(of: nvda, matching: find.text('14.36% of equity')), findsOneWidget); // server weight
      expect(find.descendant(of: nvda, matching: find.text('6.6638 sh')), findsOneWidget);
      expect(find.descendant(of: nvda, matching: find.textContaining('$kMinus\$147.94')), findsOneWidget);

      // XLV (148.9) sits below its 156.93 stop: said plainly, with a real minus-free wording
      final xlv = find.byWidgetPredicate((w) => w is PositionRow && w.row.position.symbol == 'XLV');
      expect(find.descendant(of: xlv, matching: find.text('5.36% through')), findsOneWidget);

      final meta = find.byWidgetPredicate((w) => w is PositionRow && w.row.position.symbol == 'META');
      expect(find.descendant(of: meta, matching: find.text('No stop')), findsOneWidget);
    });

    testWidgets('a flat portfolio shows the empty state and an all-cash allocation', (tester) async {
      final s = fixtureStatus();
      final flat = s.copyWith(account: AccountSnapshot(at: s.account!.at, equity: 1200, cash: 1200, buyingPower: 1200, positions: const []));
      final h = await openHarness(tester, status: flat);
      await pumpPortfolio(tester, h);

      expect(find.byType(PositionRow), findsNothing);
      expect(find.text('No positions'), findsOneWidget);
      expect(find.text('The portfolio is all cash.'), findsOneWidget);
      expect(find.text('All cash: nothing is at risk.'), findsOneWidget);
    });

    testWidgets('allocation reads the invested share and the heat against its cap', (tester) async {
      final h = await openHarness(tester);
      await pumpPortfolio(tester, h);

      expect(find.text('66.05% invested across 8 names; 30.18% cash'), findsOneWidget);
      // cap = 4 positions x 1.5% = 6.00%; heat 2.09% from the performance fixture
      expect(find.text('2.09% of equity is at risk if every stop is hit, against a 6.00% cap'), findsOneWidget);
      expect(find.text('Other'), findsOneWidget); // 8 names fold past the top 4
    });

    testWidgets('tapping a position opens its symbol page', (tester) async {
      final h = await openHarness(tester);
      await pumpPortfolio(tester, h);

      await tester.ensureVisible(find.byType(PositionRow).first);

      await tester.pump();
      await tester.tap(find.descendant(of: find.byType(PositionRow).first, matching: find.text('6.6638 sh')));
      await settle(tester);

      expect(find.byType(SymbolPage), findsOneWidget);
      expect(tester.widget<SymbolPage>(find.byType(SymbolPage)).symbol, 'NVDA');
    });
  });

  group('orders and report', () {
    testWidgets('shows only open orders, newest first, and the see-all link calls back', (tester) async {
      var seeAll = 0;
      final h = await openHarness(tester, orders: [
        testOrder('old-pending', createdAt: 100),
        testOrder('done', status: OrderStatus.filled, createdAt: 300),
        testOrder('new-working', status: OrderStatus.submitted, createdAt: 200),
      ]);
      await pumpPortfolio(tester, h, onSeeAll: () => seeAll++);

      final ids = [for (final w in tester.widgetList<OrderCard>(find.byType(OrderCard))) w.order.id];
      expect(ids, ['new-working', 'old-pending']);
      expect(find.text('2 open, 1 awaiting approval'), findsOneWidget);

      await tester.ensureVisible(find.text('Journal and orders'));

      await tester.pump();
      await tester.tap(find.text('Journal and orders'));
      expect(seeAll, 1);
    });

    testWidgets('with no open orders it says nothing is working', (tester) async {
      final h = await openHarness(tester, orders: [testOrder('done', status: OrderStatus.filled)]);
      await pumpPortfolio(tester, h);

      expect(find.byType(OrderCard), findsNothing);
      expect(find.text('No orders are working.'), findsOneWidget);
    });

    testWidgets('the latest report card shows headline, grade and result, and opens the report', (tester) async {
      final h = await openHarness(tester); // fixture: VRT trade report, grade C, -$53.84
      await pumpPortfolio(tester, h);

      await tester.ensureVisible(find.text('Sample trade review: VRT position closed.'));

      await tester.pump();
      expect(find.text('Sample trade review: VRT position closed.'), findsOneWidget);
      expect(find.textContaining('Latest report \u00b7 Trade'), findsOneWidget);
      expect(find.text('C'), findsOneWidget);
      expect(find.textContaining('$kMinus\$53.84'), findsOneWidget);

      await tester.tap(find.text('Sample trade review: VRT position closed.'));
      await settle(tester);
      expect(tester.widget<ReportPage>(find.byType(ReportPage)).id, 'trade-VRT-1790602202000');
    });

    testWidgets('the report card is hidden when there are no reports', (tester) async {
      final h = await openHarness(tester, reports: const []);
      await pumpPortfolio(tester, h);

      expect(find.textContaining('Latest report'), findsNothing);
    });
  });

  group('refresh and connection', () {
    testWidgets('pulling down forces equity, performance and reports to reload', (tester) async {
      final h = await openHarness(tester);
      await pumpPortfolio(tester, h);
      final eq = h.api.count('equity');
      final perf = h.api.count('performance');
      final rep = h.api.count('reports');
      final st = h.api.count('status');

      await tester.drag(find.byType(CustomScrollView).first, const Offset(0, 400));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await tester.runAsync(h.pump);
      await settle(tester);

      expect(h.api.count('equity'), eq + 1);
      expect(h.api.count('performance'), perf + 1);
      expect(h.api.count('reports'), rep + 1);
      expect(h.api.count('status'), greaterThan(st));
    });

    testWidgets('offline shows the stale banner while keeping the numbers', (tester) async {
      final h = await openHarness(tester);
      await pumpPortfolio(tester, h);
      expect(find.byType(StaleBanner), findsNothing);

      h.events.onClose();
      await settle(tester);

      expect(find.byType(StaleBanner), findsOneWidget);
      expect(find.textContaining('Offline'), findsOneWidget);
      expect(find.text('\$9,835.17'), findsOneWidget);
    });
  });

  group('layout', () {
    Future<StoreHarness> full(WidgetTester tester) => openHarness(tester, orders: [
          testOrder('a', createdAt: 2),
          testOrder('b', status: OrderStatus.submitted, createdAt: 3),
        ]);

    testWidgets('360x640 at text scale 2.0 lays out without overflow', (tester) async {
      final h = await full(tester);
      await pumpPortfolio(tester, h, size: const Size(360, 640), textScale: 2);
      await tester.drag(find.byType(CustomScrollView).first, const Offset(0, -1500));
      await settle(tester);

      expect(tester.takeException(), isNull);
      expect(find.byType(PositionRow), findsWidgets);
    });

    testWidgets('840x900 puts allocation and orders in a second column beside the hero', (tester) async {
      final h = await full(tester);
      await pumpPortfolio(tester, h, size: const Size(840, 900));

      expect(tester.takeException(), isNull);
      final heroRight = tester.getTopRight(find.byType(EquityHero)).dx;
      expect(tester.getTopLeft(find.byType(AllocationPanel)).dx, greaterThan(heroRight));
      expect(tester.getTopLeft(find.byType(PositionsPanel)).dx, tester.getTopLeft(find.byType(EquityHero)).dx);
    });

    testWidgets('a phone keeps one column with allocation below the chart', (tester) async {
      final h = await full(tester);
      await pumpPortfolio(tester, h);

      final hero = tester.getTopLeft(find.byType(EquityHero));
      final alloc = tester.getTopLeft(find.byType(AllocationPanel));
      expect(alloc.dx, hero.dx);
      expect(alloc.dy, greaterThan(hero.dy));
    });
  });
}
