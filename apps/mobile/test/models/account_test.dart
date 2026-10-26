import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('account_parsesLiveSnapshot', () {
    final status =
        jsonDecode(File('test/fixtures/status.json').readAsStringSync())
            as Map<String, dynamic>;
    final account =
        AccountSnapshot.fromJson(status['account'] as Map<String, dynamic>);

    expect(account.equity, closeTo(9835.17, 0.01));
    expect(account.positions, hasLength(8));
    expect(account.positions.first.symbol, 'ADBE');
    expect(account.positions.first.marketValue, closeTo(520.23, 0.01));
    expect(account.cash, greaterThanOrEqualTo(0));
    expect(account.buyingPower, greaterThanOrEqualTo(account.cash));
  });

  test('account_parsesBrokerStatus', () {
    final status =
        jsonDecode(File('test/fixtures/status.json').readAsStringSync())
            as Map<String, dynamic>;
    final broker =
        BrokerStatus.fromJson(status['broker'] as Map<String, dynamic>);

    expect(broker.state, BrokerState.connected);
    expect(broker.tools, contains('get_equity_quotes'));
    expect(broker.error, isNull);
  });
}
