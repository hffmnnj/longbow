import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/api/harness_api.dart';
import 'package:longbow/features/markets/markets_screen.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

MarketOverview _market() => MarketOverview.fromJson(
      jsonDecode(File('test/fixtures/market_overview.json').readAsStringSync())
          as Map<String, dynamic>,
    );

/// A harness whose market endpoint answers from the synthetic fixture.
Future<StoreHarness> _ready(WidgetTester tester) async {
  final harness = await StoreHarness.create();
  harness.api.on('marketOverview', () async => _market());
  await tester.runAsync(harness.start);
  return harness;
}

Future<void> _pumpLoaded(WidgetTester tester, StoreHarness harness) async {
  await pumpScreen(tester, const MarketsScreen(), harness: harness);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('markets_regimeReadingAndHeadlines', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    // The regime sentence leads; the four headline figures sit beneath it.
    expect(find.text('Sideways'), findsOneWidget);
    expect(find.text('19.4'), findsWidgets);
    expect(find.text('78th percentile, 1Y'), findsOneWidget);
    expect(find.text('Contango'), findsOneWidget);
    expect(find.text('5 of 11 above 50d'), findsOneWidget);
    expect(find.text('0 of 4 above their 50 day average'), findsOneWidget);
    expect(find.textContaining('Data as of'), findsOneWidget);
  });

  testWidgets('markets_trendRowsAndSegment', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    // Indices by default: last, signed 1-day change, spark evidence, SMA flags.
    expect(find.text('SPY'), findsOneWidget);
    expect(find.text('QQQ'), findsOneWidget);
    expect(find.text('\u22120.52%'), findsOneWidget);
    expect(find.text('RSI 42'), findsOneWidget);
    expect(find.text('50d'), findsNWidgets(4));
    expect(find.text('200d'), findsNWidgets(4));

    // The segment swaps to sectors with strength against SPY.
    await tester.tap(find.text('Sectors'));
    await tester.pumpAndSettle();
    expect(find.text('XLK'), findsOneWidget);
    expect(find.text('XLP'), findsOneWidget);
    expect(
      find.text(
        'Technology leads SPY over 3 months; Consumer Staples trails',
      ),
      findsOneWidget,
    );
    expect(find.text('vs SPY'), findsWidgets);
  });

  testWidgets('markets_calendarGroupedAndEarningsHeld', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    // Calendar days group their releases.
    // The week-ahead panels sit below the fold; scroll until built.
    await tester.scrollUntilVisible(
      find.text('WED, OCT 28'),
      300,
      scrollable: find.byWidgetPredicate(
        (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
      ),
    );
    expect(find.text('WED, OCT 28'), findsWidgets);
    expect(find.text('CB Consumer Confidence'), findsOneWidget);
    expect(find.text('THU, OCT 29'), findsWidgets);

    // Held names carry a chip so personal exposure reads at a glance.
    expect(find.text('ADBE'), findsOneWidget);
    expect(find.text('MSFT'), findsOneWidget);
    expect(find.text('Held'), findsWidgets);
    expect(
      find.text('4 held names report in the next 30 days'),
      findsOneWidget,
    );
  });

  testWidgets('markets_loadingSkeleton', (tester) async {
    final harness = await StoreHarness.create();
    addTearDown(harness.dispose);
    // Gate the endpoint so the load stays in flight and the skeleton shows.
    harness.api.on('marketOverview', () => Completer<MarketOverview>().future);
    await pumpScreen(tester, const MarketsScreen(), harness: harness);

    expect(find.byType(SkeletonBlock), findsWidgets);
  });

  testWidgets('markets_errorAndRetry', (tester) async {
    final harness = await StoreHarness.create();
    harness.api.fail('marketOverview', const ApiError(0, 'boom'));
    await tester.runAsync(harness.start);
    addTearDown(harness.dispose);
    await pumpScreen(tester, const MarketsScreen(), harness: harness);
    await tester.pumpAndSettle();

    expect(find.text('Retry'), findsWidgets);
    expect(find.textContaining('boom'), findsWidgets);
    await tester.tap(find.text('Retry').first);
    await tester.pumpAndSettle();
    expect(harness.api.count('marketOverview'), greaterThanOrEqualTo(2));
  });

  testWidgets('markets_staleWhileRefreshing', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);
    expect(find.text('SPY'), findsOneWidget);

    harness.api.fail('marketOverview', const ApiError(0, 'stale'));
    await tester.runAsync(() => harness.notifier.loadMarket(force: true));
    await tester.pump();

    // Stale figures stay on screen with a quiet note.
    expect(find.text('SPY'), findsOneWidget);
    expect(find.textContaining('Could not refresh'), findsWidgets);
  });

  testWidgets('markets_offlineBanner', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await _pumpLoaded(tester, harness);

    harness.events.onClose();
    await tester.pump();

    expect(find.textContaining('Offline'), findsOneWidget);
  });

  testWidgets('markets_smallTextScaled', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await pumpScreen(
      tester,
      const MarketsScreen(),
      harness: harness,
      size: const Size(360, 640),
      textScale: 2.0,
    );
    await tester.pumpAndSettle();

    expect(find.text('Sideways'), findsOneWidget);
    expect(find.text('SPY'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('markets_wide', (tester) async {
    final harness = await _ready(tester);
    addTearDown(harness.dispose);
    await pumpScreen(
      tester,
      const MarketsScreen(),
      harness: harness,
      size: const Size(840, 900),
    );
    await tester.pumpAndSettle();

    expect(find.text('Sideways'), findsOneWidget);
    expect(find.text('SPY'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
