import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('analytics_parsesEquityHistory', () {
    final json =
        jsonDecode(File('test/fixtures/equity_3m.json').readAsStringSync())
            as Map<String, dynamic>;
    final history = EquityHistory.fromJson(json);

    expect(history.points, hasLength(2));
    expect(history.returnPct, closeTo(-0.0306, 1e-4));
    expect(history.benchmarkReturnPct, isNotNull);
    expect(history.holdingsReplay, hasLength(6));
  });

  test('analytics_parsesPerformanceSummary', () {
    final json =
        jsonDecode(File('test/fixtures/performance.json').readAsStringSync())
            as Map<String, dynamic>;
    final summary = PerformanceSummary.fromJson(json);

    expect(summary.realizedPnl, closeTo(-521.12, 1e-9));
    expect(summary.trades, hasLength(6));
    expect(summary.trades.first.source, isA<TradeSource>());
    expect(summary.exposure, hasLength(6));
    // Server sent no per-status counts; the map stays present but empty.
    expect(summary.ordersByStatus, isEmpty);
  });

  test('analytics_parsesMarketOverview', () {
    final json =
        jsonDecode(File('test/fixtures/market_overview.json').readAsStringSync())
            as Map<String, dynamic>;
    final overview = MarketOverview.fromJson(json);

    expect(overview.regime, 'Sideways');
    expect(overview.indices.first.symbol, 'SPY');
    expect(overview.indices.first.last, closeTo(759.97, 1e-9));
    expect(overview.volatility.vix, closeTo(19.45, 1e-9));
    expect(overview.breadth.aboveSma50, 5);
    expect(overview.breadth.total, 11);
    expect(overview.yields, isNotEmpty);
    expect(overview.calendar.length, lessThanOrEqualTo(6));
    expect(overview.earnings.length, lessThanOrEqualTo(6));
  });
}
