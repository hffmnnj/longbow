import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('status_parsesLiveStatus', () {
    final json =
        jsonDecode(File('test/fixtures/status.json').readAsStringSync())
            as Map<String, dynamic>;
    final status = StatusResponse.fromJson(json);

    expect(status.agent.state, AgentState.idle);
    expect(status.agent.model, contains('gpt'));
    expect(status.broker.state, BrokerState.connected);
    expect(status.market.session, MarketSession.closed);
    expect(status.settings.mode, TradingMode.auto);
    expect(status.halts, isEmpty);
    expect(status.liveTrading, isTrue);
    expect(status.models.main, contains('gpt-6.1-sol'));
    expect(status.dayPnl, closeTo(-2.62, 1e-4));
    expect(status.account, isNotNull);
  });

  test('status_copyWithReplacesHalts', () {
    final json =
        jsonDecode(File('test/fixtures/status.json').readAsStringSync())
            as Map<String, dynamic>;
    final status = StatusResponse.fromJson(json);

    final halted = status.copyWith(halts: [HaltReason.killSwitch]);

    expect(halted.halts, [HaltReason.killSwitch]);
    expect(halted.liveTrading, status.liveTrading);
    expect(halted.models.main, status.models.main);
  });
}
