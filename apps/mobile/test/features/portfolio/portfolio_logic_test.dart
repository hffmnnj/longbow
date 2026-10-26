import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/domain/analytics_calc.dart';
import 'package:longbow/features/portfolio/portfolio_logic.dart';
import 'package:longbow/models/models.dart';

import '../../data/model_builders.dart';
import 'portfolio_test_data.dart';

Position pos(String symbol, double value) =>
    Position(symbol: symbol, quantity: 1, averageCost: value, marketValue: value, unrealizedPnl: 0);

void main() {
  group('equityVsSpyReading', () {
    test('ahead of SPY', () {
      expect(equityVsSpyReading(equityWith(returnPct: 3.2, benchmarkReturnPct: 2.1)), 'Up 3.2% since Oct 1, 1.1 points ahead of SPY');
    });

    test('up but behind SPY', () {
      expect(equityVsSpyReading(equityWith(returnPct: 1, benchmarkReturnPct: 2.5)), 'Up 1.0% since Oct 1, 1.5 points behind SPY');
    });

    test('down while SPY fell less', () {
      expect(equityVsSpyReading(equityWith(returnPct: -2, benchmarkReturnPct: -0.5)), 'Down 2.0% since Oct 1, 1.5 points behind SPY');
    });

    test('down less than SPY counts as ahead', () {
      expect(equityVsSpyReading(equityWith(returnPct: -0.4, benchmarkReturnPct: -2)), 'Down 0.40% since Oct 1, 1.6 points ahead of SPY');
    });

    test('within a twentieth of a point is level', () {
      expect(equityVsSpyReading(equityWith(returnPct: 2.02, benchmarkReturnPct: 2)), 'Up 2.0% since Oct 1, level with SPY');
    });

    test('without a benchmark only the account is described', () {
      expect(equityVsSpyReading(equityWith(returnPct: 3.2)), 'Up 3.2% since Oct 1');
    });

    test('no sentence for a single mark or a missing return', () {
      expect(equityVsSpyReading(const EquityHistory(points: [EquityPoint(at: 1, date: '2026-10-01', equity: 1)], holdingsReplay: [], returnPct: 1)), isNull);
      expect(equityVsSpyReading(const EquityHistory(points: [], holdingsReplay: [])), isNull);
    });
  });

  test('openOrders keeps working states and orders newest first', () {
    final open = openOrders([
      testOrder('filled', status: OrderStatus.filled, createdAt: 9),
      testOrder('failed', status: OrderStatus.failed, createdAt: 8),
      testOrder('held', status: OrderStatus.held, createdAt: 1),
      testOrder('partial', status: OrderStatus.partiallyFilled, createdAt: 5),
      testOrder('pending', createdAt: 3),
    ]);
    expect(open.map((o) => o.id), ['partial', 'pending', 'held']);
  });

  group('allocationSlices', () {
    test('folds past the top names into Other and ends with cash, all as percent of equity', () {
      final rows = positionStops([pos('A', 400), pos('B', 300), pos('C', 100), pos('D', 50)], const [], 1000);
      final slices = allocationSlices(rows, 1000, 150, names: 2);
      expect([for (final s in slices) (s.label, s.weightPct)], [('A', 40.0), ('B', 30.0), ('Other', 15.0), ('Cash', 15.0)]);
    });

    test('is empty without equity', () {
      expect(allocationSlices(const [], 0, 0), isEmpty);
    });
  });

  test('stopTone marks near stops as loss, then warn, then calm', () {
    expect(stopTone(2.9), ChartTone.loss);
    expect(stopTone(3), ChartTone.warn);
    expect(stopTone(5.99), ChartTone.warn);
    expect(stopTone(6), ChartTone.muted);
  });
}
