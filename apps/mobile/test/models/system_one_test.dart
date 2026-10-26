import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

/// The System One block as the server sends it inside GET /api/status.
const _systemOneJson = {
  'state': 'ok',
  'model': 'jev-latest',
  'calls24h': 42,
  'medianLatencyMs': 150,
  'inputTokens24h': 9000,
  'lastOkAt': 1792978597214,
};

Map<String, dynamic> _settingsJson({Map<String, dynamic>? systemOne}) {
  final json = {
    'mode': 'auto',
    'killSwitch': false,
    'drawdownHalted': false,
    'cycleMinutesOpen': 30,
    'cycleMinutesClosed': 240,
    'watchlist': ['SPY'],
    'risk': {
      'maxRiskPerTradePct': 1.5,
      'maxPositionPct': 30.0,
      'maxSectorPct': 60.0,
      'maxPositions': 4,
      'maxOrderNotionalUsd': 500.0,
      'minOrderNotionalUsd': 5.0,
      'dailyLossHaltPct': 3.0,
      'monthlyDrawdownHaltPct': 8.0,
      'maxEntriesPerDay': 2,
      'minHoldDays': 1,
      'maxSpreadBps': 20.0,
      'maxSlippageBps': 10.0,
      'noTradeOpenMinutes': 30,
      'noTradeCloseMinutes': 15,
      'maxDayTrades5d': 3,
      'minEvToCost': 2.0,
      'earningsBlackoutDays': 5,
      'minAvgDollarVolumeUsd': 20000000.0,
    },
  };
  if (systemOne != null) json['systemOne'] = systemOne;
  return json;
}

Map<String, dynamic> _statusJson({Map<String, dynamic>? systemOne}) {
  final json = jsonDecode(File('test/fixtures/status.json').readAsStringSync())
      as Map<String, dynamic>;
  if (systemOne != null) {
    json['systemOne'] = systemOne;
  }
  return json;
}

void main() {
  test('systemOne_parsesFullStatusObject', () {
    final status = StatusResponse.fromJson(_statusJson(systemOne: {
      ..._systemOneJson,
      'cooldownUntil': 1792982800000,
      'lastError': 'slow upstream',
    }));

    final info = status.systemOne!;
    expect(info.state, SystemOneState.ok);
    expect(info.model, 'jev-latest');
    expect(info.calls24h, 42);
    expect(info.medianLatencyMs, 150);
    expect(info.inputTokens24h, 9000);
    expect(info.cooldownUntil, 1792982800000);
    expect(info.lastError, 'slow upstream');
    expect(info.lastOkAt, 1792978597214);
  });

  test('systemOne_missingKeyLeavesStatusNullAndSettingsDefaulted', () {
    final status = StatusResponse.fromJson(_statusJson());

    expect(status.systemOne, isNull);
    expect(status.settings.systemOne.enabled, isTrue);
    expect(status.settings.systemOne.gate, SystemOneGate.advise);
  });

  test('systemOne_parsesSettingsBlock', () {
    final settings = Settings.fromJson(_settingsJson(systemOne: {
      'enabled': false,
      'gate': 'block',
    }));

    expect(settings.systemOne.enabled, isFalse);
    expect(settings.systemOne.gate, SystemOneGate.block);
  });

  test('systemOne_unknownGateFallsBackToAdvise', () {
    final settings = Settings.fromJson(_settingsJson(systemOne: {
      'enabled': true,
      'gate': 'quarantine',
    }));

    expect(settings.systemOne.gate, SystemOneGate.advise);
  });

  test('systemOne_patchSendsOnlyTheFieldsSet', () {
    expect(
      const SettingsPatch(
        systemOne: SystemOneSettingsPatch(enabled: false),
      ).toJson(),
      {
        'systemOne': {'enabled': false}
      },
    );
    expect(
      const SettingsPatch(
        systemOne: SystemOneSettingsPatch(gate: SystemOneGate.block),
      ).toJson(),
      {
        'systemOne': {'gate': 'block'}
      },
    );
    expect(
      const SettingsPatch(
        systemOne: SystemOneSettingsPatch(
          enabled: true,
          gate: SystemOneGate.off,
        ),
      ).toJson(),
      {
        'systemOne': {'enabled': true, 'gate': 'off'}
      },
    );
  });
}
