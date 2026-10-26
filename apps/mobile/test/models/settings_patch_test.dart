import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('settingsPatch_toJsonOmitsUnsetFields', () {
    final json = const SettingsPatch(
      mode: TradingMode.approve,
      risk: RiskConfigPatch(maxRiskPerTradePct: 2.0),
    ).toJson();

    expect(json, {
      'mode': 'approve',
      'risk': {'maxRiskPerTradePct': 2.0},
    });
  });

  test('settingsPatch_emptyPatchSendsNothing', () {
    expect(const SettingsPatch().toJson(), isEmpty);
  });

  test('settingsPatch_riskNestsPartialFields', () {
    final json = const SettingsPatch(
      risk: RiskConfigPatch(maxPositions: 2, earningsBlackoutDays: 0),
    ).toJson();

    expect(json['risk'], {'maxPositions': 2, 'earningsBlackoutDays': 0});
    expect((json['risk'] as Map).containsKey('maxRiskPerTradePct'), isFalse);
  });

  test('settingsPatch_roundTripsThroughServerShape', () {
    final patch = SettingsPatch.fromJson({
      'mode': 'auto',
      'watchlist': ['SPY', 'QQQ'],
      'risk': {'maxPositions': 3},
    });

    expect(patch.mode, TradingMode.auto);
    expect(patch.watchlist, ['SPY', 'QQQ']);
    expect(patch.risk!.maxPositions, 3);
    expect(patch.risk!.maxRiskPerTradePct, isNull);
    expect(patch.toJson(), {
      'mode': 'auto',
      'watchlist': ['SPY', 'QQQ'],
      'risk': {'maxPositions': 3},
    });
  });
}
