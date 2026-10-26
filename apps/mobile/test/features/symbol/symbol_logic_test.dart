import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/format.dart';
import 'package:longbow/features/symbol/symbol_logic.dart';
import 'package:longbow/models/models.dart';

import '../../data/model_builders.dart';

Bar bar(String date, double close) => Bar(date: date, open: close, high: close, low: close, close: close, volume: 1);

OrderRecord fill(String side, String status, DateTime at, {double? qty, double? price}) {
  final base = testOrder('o-$side-${at.day}', status: OrderStatus.values.byName(status), createdAt: 1);
  return base.copyWith(
    updatedAt: at.millisecondsSinceEpoch,
    filledQuantity: qty,
    averageFillPrice: price,
    intent: OrderIntent(
      symbol: 'NVDA',
      side: side == 'buy' ? OrderSide.buy : OrderSide.sell,
      quantity: 2,
      orderType: OrderType.limit,
      limitPrice: 100,
      timeInForce: TimeInForce.day,
      invalidationPrice: 90,
      timeStopDate: '2026-11-01',
      thesis: 't',
      probabilityWin: 0.5,
      expectedGainPct: 2,
      expectedLossPct: 1,
      estimatedCostPct: 0.1,
      evidence: const [],
    ),
  );
}

void main() {
  group('fillMarkers', () {
    final bars = [bar('2026-10-19', 1), bar('2026-10-20', 1), bar('2026-10-22', 1)];

    test('puts a fill on its own day, buys and sells distinguished', () {
      final markers = fillMarkers(
        bars,
        [fill('buy', 'filled', DateTime.utc(2026, 10, 20, 15), qty: 1.5, price: 101.25), fill('sell', 'partiallyFilled', DateTime.utc(2026, 10, 22, 15))],
        zone: LbZone.utc,
      );
      expect(markers.map((m) => (m.index, m.kind)), [(1, ChartMarkerKind.buy), (2, ChartMarkerKind.sell)]);
      expect(markers.first.label, 'Bought 1.5 at \$101.25');
      expect(markers.last.label, 'Sold 2 at \$100.00'); // falls back to the plan when no fill price
    });

    test('a fill on a non-trading day lands on the last bar before it', () {
      final m = fillMarkers(bars, [fill('buy', 'filled', DateTime.utc(2026, 10, 21, 12))], zone: LbZone.utc);
      expect(m.single.index, 1);
    });

    test('ignores unfilled orders and fills before the first bar', () {
      final m = fillMarkers(
        bars,
        [fill('buy', 'submitted', DateTime.utc(2026, 10, 20)), fill('buy', 'cancelled', DateTime.utc(2026, 10, 20)), fill('buy', 'filled', DateTime.utc(2026, 10, 1))],
        zone: LbZone.utc,
      );
      expect(m, isEmpty);
    });

    test('no bars means no markers', () {
      expect(fillMarkers(const [], [fill('buy', 'filled', DateTime.utc(2026, 10, 20))]), isEmpty);
    });
  });

  group('price figures', () {
    test('period return is first to last close', () {
      expect(periodReturn([bar('a', 200), bar('b', 150), bar('c', 210)]), closeTo(5, 1e-9));
      expect(periodReturn(const []), isNull);
    });

    test('session change compares the live price to the close before the last bar', () {
      final c = sessionChange([bar('a', 100), bar('b', 110), bar('c', 120)], 121)!;
      expect(c.amount, closeTo(11, 1e-9));
      expect(c.pct, closeTo(10, 1e-9));
      expect(sessionChange([bar('a', 100)], 101), isNull);
    });
  });

  group('indicatorCells', () {
    const ind = SymbolIndicators(sma20: 200, sma50: 250, rsi14: 71.4, atr14: 5, return1m: -3.126, return3m: 8, avgDollarVolume: 41200000);

    test('compares price with each average and names the RSI zone', () {
      final cells = {for (final c in indicatorCells(ind, 220)) c.label: c};
      expect(cells['20-day average']!.value, '\$200.00');
      expect(cells['20-day average']!.sub, 'price above by 10.00%');
      expect(cells['20-day average']!.tone, Tone.gain);
      expect(cells['50-day average']!.sub, 'price below by 12.00%');
      expect(cells['50-day average']!.tone, Tone.loss);
      expect(cells['200-day average']!.value, '\u2014');
      expect(cells['RSI 14']!.value, '71');
      expect(cells['RSI 14']!.sub, 'overbought');
      expect(cells['ATR 14']!.sub, '2.27% of price');
      expect(cells['1M return']!.value, '$kMinus' '3.13%');
      expect(cells['3M return']!.value, '+8.00%');
      expect(cells['Avg \$ volume']!.value, '\$41M');
    });

    test('without a price the averages carry no comparison', () {
      final cells = {for (final c in indicatorCells(ind, null)) c.label: c};
      expect(cells['20-day average']!.sub, isNull);
      expect(cells['ATR 14']!.sub, isNull);
    });
  });
}
