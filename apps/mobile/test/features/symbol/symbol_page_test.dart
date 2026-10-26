import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/features/feed/decision_card.dart';
import 'package:longbow/features/history/doc_page.dart';
import 'package:longbow/features/symbol/symbol_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'symbol_test_data.dart';

Future<void> pumpSymbol(WidgetTester tester, StoreHarness h, {Size size = const Size(360, 800), double textScale = 1}) async {
  await pumpScreen(tester, const SymbolPage(symbol: 'NVDA'), harness: h, size: size, textScale: textScale);
  await settle(tester);
}

CandleChart chart(WidgetTester tester) => tester.widget<CandleChart>(find.byType(CandleChart));

Future<void> scrollTo(WidgetTester tester, Finder f) async {
  await tester.dragUntilVisible(f, find.byType(CustomScrollView).first, const Offset(0, -200));
  await settle(tester);
}

void main() {
  group('header and chart', () {
    testWidgets('shows the symbol, live price, session change and earnings date', (tester) async {
      final h = await openSymbolHarness(tester);
      await pumpSymbol(tester, h);

      expect(find.text('NVDA'), findsWidgets); // app bar title
      expect(find.text('\$211.28'), findsOneWidget); // quote.last
      // 211.28 against the close before the last bar, 212.21
      expect(find.textContaining('$kMinus\$0.93 ($kMinus' '0.44%)'), findsOneWidget);
      expect(find.textContaining('Earnings Wed, Nov 18'), findsOneWidget);
    });

    testWidgets('a held symbol summarises the position in the header', (tester) async {
      final h = await openSymbolHarness(tester);
      await pumpSymbol(tester, h);

      expect(find.text('Held'), findsOneWidget);
      expect(find.text('6.6638 sh'), findsOneWidget);
      expect(find.text('\$1,412.05'), findsWidgets);
    });

    testWidgets('an unheld symbol has no held line and no position panel', (tester) async {
      final h = await openSymbolHarness(tester, detail: nvdaDetail(held: false));
      await pumpSymbol(tester, h);

      expect(find.text('Held'), findsNothing);
      expect(find.text('POSITION'), findsNothing);
    });

    testWidgets('candles carry SMA 20/50/200, stop and entry rules, and the order fill', (tester) async {
      final h = await openSymbolHarness(tester);
      await pumpSymbol(tester, h);

      final c = chart(tester);
      expect(c.bars.length, 6);
      expect(c.smaPeriods, [20, 50, 200]);
      expect({for (final l in c.referenceLines) l.label: l.value}, {'Stop \$200.63': 200.63, 'Entry \$234.10': 234.10});
      // filled Oct 21 12:00 UTC lands on the Oct 21 bar (index 3), a buy
      expect(c.markers.single.index, 3);
      expect(c.markers.single.kind, ChartMarkerKind.buy);
    });

    testWidgets('defaults to 1Y and switching range requests it while the old chart stays visible', (tester) async {
      final gate = Completer<PriceHistory>();
      final seen = <HistoryRange>[];
      final h = await openSymbolHarness(tester, configure: (api) {
        api.handlers['history'] = (inv) {
          final r = inv.positionalArguments[1] as HistoryRange;
          seen.add(r);
          return r == HistoryRange.threeMonths ? gate.future : Future.value(nvdaDetail().history);
        };
      });
      await pumpSymbol(tester, h);
      expect(seen, [HistoryRange.oneYear]);

      await tester.tap(find.text('3M'));
      await settle(tester);

      expect(seen, [HistoryRange.oneYear, HistoryRange.threeMonths]);
      expect(find.byType(CandleChart), findsOneWidget); // previous bars still drawn
      expect(find.text('Loading 3M\u2026'), findsOneWidget);

      final fewer = PriceHistory(symbol: 'NVDA', bars: nvdaDetail().history.bars.sublist(2), source: 'nasdaq', asOf: 1);
      gate.complete(fewer);
      await tester.runAsync(h.pump);
      await settle(tester);

      expect(chart(tester).bars.length, 4);
      expect(find.text('Loading 3M\u2026'), findsNothing);
    });

    testWidgets('a history failure shows the error and Retry loads again', (tester) async {
      final h = await openSymbolHarness(tester, configure: (api) => api.fail('history', StateError('rate limited')));
      await pumpSymbol(tester, h);

      expect(find.text('Could not load price history'), findsOneWidget);
      expect(find.text('rate limited'), findsOneWidget);
      expect(find.byType(CandleChart), findsNothing);
      final before = h.api.count('history');
      h.api.on('history', () async => nvdaDetail().history);
      await tester.tap(find.widgetWithText(OutlinedButton, 'Retry'));
      await tester.runAsync(h.pump);
      await settle(tester);

      expect(h.api.count('history'), before + 1);
      expect(find.byType(CandleChart), findsOneWidget);
    });

    testWidgets('empty history says so', (tester) async {
      final h = await openSymbolHarness(tester, configure: (api) => api.on('history', () async => PriceHistory(symbol: 'NVDA', bars: const [], source: 'x', asOf: 1)));
      await pumpSymbol(tester, h);

      expect(find.text('No price history for NVDA'), findsOneWidget);
    });
  });

  group('detail sections', () {
    testWidgets('indicators show averages against price, RSI zone, returns and the 52 week range', (tester) async {
      final h = await openSymbolHarness(tester);
      await pumpSymbol(tester, h);
      await scrollTo(tester, find.text('AVG \$ VOLUME'));

      expect(find.text('20-DAY AVERAGE'), findsOneWidget);
      expect(find.text('\$225.54'), findsOneWidget);
      expect(find.text('price below by 6.32%'), findsOneWidget); // (211.28-225.5415)/225.5415
      expect(find.text('38'), findsOneWidget);
      expect(find.text('neutral'), findsOneWidget);
      expect(find.text('$kMinus' '6.06%'), findsOneWidget);
      expect(find.text('+7.35%'), findsOneWidget);
      expect(find.text('\$23.8B'), findsOneWidget);
      expect(find.text('52-week low \$164.27'), findsOneWidget);
      expect(find.text('high \$243.37'), findsOneWidget);
    });

    testWidgets('position card shows cost, unrealized result and the stop with its source', (tester) async {
      final h = await openSymbolHarness(tester);
      await pumpSymbol(tester, h);
      await scrollTo(tester, find.text('Average cost'));

      expect(find.text('\$234.10'), findsWidgets);
      expect(find.textContaining('$kMinus\$147.94 ($kMinus' '9.48%)'), findsOneWidget); // -147.94 on cost 1559.99
      expect(find.text('\$200.63'), findsWidgets);
      expect(find.textContaining('from the thesis invalidation'), findsOneWidget);
      expect(find.textContaining('below price'), findsOneWidget); // 10.65 / 211.28 = 5.04%
      expect(find.textContaining('5.04% below price'), findsOneWidget);
    });

    testWidgets('the thesis renders as markdown and opens the note', (tester) async {
      final h = await openSymbolHarness(tester);
      await pumpSymbol(tester, h);
      await scrollTo(tester, find.text('Open note'));

      expect(find.textContaining('synthetic sample thesis'), findsOneWidget);
      await tester.tap(find.text('Open note'));
      await settle(tester);

      expect(tester.widget<DocPage>(find.byType(DocPage)).id, 'theses/NVDA.md');
    });

    testWidgets('lists this symbol\'s order and its decisions', (tester) async {
      final h = await openSymbolHarness(tester);
      await pumpSymbol(tester, h);
      await scrollTo(tester, find.text('RECENT DECISIONS'));

      expect(find.text('0.65 @ \$759.40 \u00b7 \$493.61'), findsOneWidget);
      expect(find.textContaining('Filled \u00b7'), findsOneWidget);
      // seven decisions on file: the five newest, newest first
      final ids = [for (final w in tester.widgetList<DecisionCard>(find.byType(DecisionCard))) w.entry.id];
      expect(ids, ['j6', 'j5', 'j4', 'j3', 'j2']);
    });

    testWidgets('no orders and no decisions say so', (tester) async {
      final h = await openSymbolHarness(tester, detail: nvdaDetail(orders: false, journal: false, thesis: false));
      await pumpSymbol(tester, h);
      await scrollTo(tester, find.text('No journal entries for NVDA'));

      expect(find.text('No orders for NVDA'), findsOneWidget);
      expect(find.byType(DecisionCard), findsNothing);
      expect(find.text('THESIS'), findsNothing);
    });

    testWidgets('a detail failure shows Retry that reloads, and the chart still works', (tester) async {
      final h = await openSymbolHarness(tester, configure: (api) => api.fail('symbolDetail', StateError('down')));
      await pumpSymbol(tester, h);

      expect(find.byType(CandleChart), findsOneWidget);
      expect(find.textContaining('down'), findsOneWidget);
      h.api.on('symbolDetail', () async => nvdaDetail());
      await scrollTo(tester, find.widgetWithText(OutlinedButton, 'Retry'));
      await tester.tap(find.widgetWithText(OutlinedButton, 'Retry'));
      await tester.runAsync(h.pump);
      await settle(tester);

      expect(find.text('INDICATORS'), findsOneWidget);
    });

    testWidgets('pull to refresh reloads the detail and the history', (tester) async {
      final h = await openSymbolHarness(tester);
      await pumpSymbol(tester, h);
      final d = h.api.count('symbolDetail');
      final hist = h.api.count('history');

      await tester.drag(find.byType(CustomScrollView).first, const Offset(0, 400));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await tester.runAsync(h.pump);
      await settle(tester);

      expect(h.api.count('symbolDetail'), d + 1);
      expect(h.api.count('history'), hist + 1);
    });

    testWidgets('while the detail loads a skeleton stands in and the chart is not blocked', (tester) async {
      final gate = Completer<SymbolDetail>();
      final h = await openSymbolHarness(tester, configure: (api) => api.on('symbolDetail', () => gate.future));
      await pumpSymbol(tester, h);

      expect(find.byType(SkeletonBlock), findsWidgets);
      expect(find.byType(CandleChart), findsOneWidget);
      expect(find.text('INDICATORS'), findsNothing);
    });
  });

  group('layout', () {
    testWidgets('360x640 at text scale 2.0 lays out without overflow', (tester) async {
      final h = await openSymbolHarness(tester);
      await pumpSymbol(tester, h, size: const Size(360, 640), textScale: 2);
      await scrollTo(tester, find.text('RECENT DECISIONS'));

      expect(tester.takeException(), isNull);
    });

    testWidgets('on a tablet the content stays one column no wider than 720', (tester) async {
      final h = await openSymbolHarness(tester);
      await pumpSymbol(tester, h, size: const Size(840, 900));

      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byType(CandleChart)).width, lessThanOrEqualTo(symbolMaxWidth));
    });
  });
}
