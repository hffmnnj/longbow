import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('market_parsesSpyPriceHistory', () {
    final json =
        jsonDecode(File('test/fixtures/history_spy_3m.json').readAsStringSync())
            as Map<String, dynamic>;
    final history = PriceHistory.fromJson(json);

    expect(history.symbol, 'SPY');
    expect(history.bars, hasLength(6));
    // Oldest first: dates ascend through the trimmed window.
    for (var i = 1; i < history.bars.length; i++) {
      expect(history.bars[i].date.compareTo(history.bars[i - 1].date), greaterThan(0));
    }
    expect(history.bars.last.close, greaterThan(0));
    expect(history.source, isNotEmpty);
  });

  test('market_parsesClockFromStatus', () {
    final status =
        jsonDecode(File('test/fixtures/status.json').readAsStringSync())
            as Map<String, dynamic>;
    final clock =
        MarketClock.fromJson(status['market'] as Map<String, dynamic>);

    expect(clock.session, MarketSession.closed);
    expect(clock.isOpen, isFalse);
    expect(clock.tradingDay, matches(r'^\d{4}-\d{2}-\d{2}$'));
  });

  test('market_parsesNvdaQuote', () {
    final json =
        jsonDecode(File('test/fixtures/symbol_nvda.json').readAsStringSync())
            as Map<String, dynamic>;
    final quote = Quote.fromJson(json['quote'] as Map<String, dynamic>);

    expect(quote.symbol, 'NVDA');
    expect(quote.last, closeTo(211.28, 1e-6));
    expect(quote.bid, lessThanOrEqualTo(quote.ask));
  });
}
