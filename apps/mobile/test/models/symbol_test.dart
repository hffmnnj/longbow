import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('symbol_parsesNvdaDetail', () {
    final json =
        jsonDecode(File('test/fixtures/symbol_nvda.json').readAsStringSync())
            as Map<String, dynamic>;
    final detail = SymbolDetail.fromJson(json);

    expect(detail.symbol, 'NVDA');
    expect(detail.quote, isNotNull);
    expect(detail.indicators.sma50, closeTo(222.48, 0.01));
    expect(detail.history.bars, hasLength(6));
    expect(detail.stop, isNotNull);
    expect(detail.stop!.price, closeTo(200.63, 1e-9));
    expect(detail.stop!.source, StopSource.thesis);
    expect(detail.nextEarnings, isNotNull);
    expect(detail.nextEarnings!.date, '2026-11-18');
    expect(detail.journal.single.action, JournalAction.hold);
    expect(detail.orders, isEmpty);
  });
}
