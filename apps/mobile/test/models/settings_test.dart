import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

Map<String, dynamic> loadJson(String name) {
  final text = File('test/fixtures/$name').readAsStringSync();
  return jsonDecode(text) as Map<String, dynamic>;
}

void main() {
  test('settings_parsesLiveSettings', () {
    final settings = Settings.fromJson(loadJson('settings.json'));

    expect(settings.mode, TradingMode.auto);
    expect(settings.killSwitch, isFalse);
    expect(settings.drawdownHalted, isFalse);
    expect(settings.watchlist.first, 'SPY');
    expect(settings.risk.maxRiskPerTradePct, 1.5);
    expect(settings.risk.maxPositions, 4);
    expect(settings.risk.minAvgDollarVolumeUsd, 20000000);
  });

  test('settings_defaultsMirrorServerContract', () {
    expect(defaultSettings.mode, TradingMode.auto);
    expect(defaultSettings.watchlist, hasLength(13));
    expect(defaultSettings.risk.maxRiskPerTradePct, 1.5);
    expect(defaultRisk.earningsBlackoutDays, 5);
  });

  test('settings_copyWithReplacesOnlyGivenFields', () {
    final updated = defaultSettings.copyWith(
      mode: TradingMode.approve,
      killSwitch: true,
    );

    expect(updated.mode, TradingMode.approve);
    expect(updated.killSwitch, isTrue);
    expect(updated.watchlist, defaultSettings.watchlist);
    expect(updated.risk, defaultSettings.risk);
  });

  test('settings_parsesCryptoSleeve', () {
    final settings = Settings.fromJson({
      ...loadJson('settings.json'),
      'crypto': {
        'enabled': true,
        'allowed': ['BTC-USD', 'ETH-USD'],
        'maxPortfolioPct': 8.0,
        'maxOrderNotionalUsd': 40.0,
        'maxEntriesPerDay': 1,
        'maxSpreadBps': 300.0,
        'minRewardRisk': 2.0,
      },
    });

    expect(settings.crypto.enabled, isTrue);
    expect(settings.crypto.allowed, ['BTC-USD', 'ETH-USD']);
    expect(settings.crypto.maxPortfolioPct, 8);
    expect(settings.crypto.maxOrderNotionalUsd, 40);
    expect(settings.crypto.maxEntriesPerDay, 1);
    expect(settings.crypto.maxSpreadBps, 300);
    expect(settings.crypto.minRewardRisk, 2);
  });

  test('settings_missingCryptoDefaultsToAQuietSleeve', () {
    final settings = Settings.fromJson(loadJson('settings.json'));

    expect(settings.crypto.enabled, isFalse);
    expect(settings.crypto.maxPortfolioPct, 8);
    expect(settings.crypto.maxOrderNotionalUsd, 40);
  });
}
