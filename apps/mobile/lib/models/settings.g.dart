// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'settings.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SystemOneSettings _$SystemOneSettingsFromJson(Map<String, dynamic> json) =>
    SystemOneSettings(
      enabled: json['enabled'] as bool,
      gate: $enumDecode(
        _$SystemOneGateEnumMap,
        json['gate'],
        unknownValue: SystemOneGate.advise,
      ),
    );

const _$SystemOneGateEnumMap = {
  SystemOneGate.off: 'off',
  SystemOneGate.advise: 'advise',
  SystemOneGate.block: 'block',
};

RiskConfig _$RiskConfigFromJson(Map<String, dynamic> json) => RiskConfig(
  maxRiskPerTradePct: (json['maxRiskPerTradePct'] as num).toDouble(),
  maxPositionPct: (json['maxPositionPct'] as num).toDouble(),
  maxSectorPct: (json['maxSectorPct'] as num).toDouble(),
  maxPositions: (json['maxPositions'] as num).toInt(),
  maxOrderNotionalUsd: (json['maxOrderNotionalUsd'] as num).toDouble(),
  minOrderNotionalUsd: (json['minOrderNotionalUsd'] as num).toDouble(),
  dailyLossHaltPct: (json['dailyLossHaltPct'] as num).toDouble(),
  monthlyDrawdownHaltPct: (json['monthlyDrawdownHaltPct'] as num).toDouble(),
  maxEntriesPerDay: (json['maxEntriesPerDay'] as num).toInt(),
  minHoldDays: (json['minHoldDays'] as num).toInt(),
  maxSpreadBps: (json['maxSpreadBps'] as num).toDouble(),
  maxSlippageBps: (json['maxSlippageBps'] as num).toDouble(),
  noTradeOpenMinutes: (json['noTradeOpenMinutes'] as num).toInt(),
  noTradeCloseMinutes: (json['noTradeCloseMinutes'] as num).toInt(),
  maxDayTrades5d: (json['maxDayTrades5d'] as num).toInt(),
  minEvToCost: (json['minEvToCost'] as num).toDouble(),
  earningsBlackoutDays: (json['earningsBlackoutDays'] as num).toInt(),
  minAvgDollarVolumeUsd: (json['minAvgDollarVolumeUsd'] as num).toDouble(),
);

Settings _$SettingsFromJson(Map<String, dynamic> json) => Settings(
  mode: $enumDecode(
    _$TradingModeEnumMap,
    json['mode'],
    unknownValue: TradingMode.off,
  ),
  killSwitch: json['killSwitch'] as bool,
  drawdownHalted: json['drawdownHalted'] as bool,
  drawdownHaltedMonth: json['drawdownHaltedMonth'] as String?,
  cycleMinutesOpen: (json['cycleMinutesOpen'] as num).toInt(),
  cycleMinutesClosed: (json['cycleMinutesClosed'] as num).toInt(),
  watchlist: (json['watchlist'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  risk: RiskConfig.fromJson(json['risk'] as Map<String, dynamic>),
  systemOne: json['systemOne'] == null
      ? defaultSystemOne
      : SystemOneSettings.fromJson(json['systemOne'] as Map<String, dynamic>),
);

const _$TradingModeEnumMap = {
  TradingMode.off: 'off',
  TradingMode.approve: 'approve',
  TradingMode.auto: 'auto',
};

SystemOneSettingsPatch _$SystemOneSettingsPatchFromJson(
  Map<String, dynamic> json,
) => SystemOneSettingsPatch(
  enabled: json['enabled'] as bool?,
  gate: $enumDecodeNullable(
    _$SystemOneGateEnumMap,
    json['gate'],
    unknownValue: SystemOneGate.advise,
  ),
);

Map<String, dynamic> _$SystemOneSettingsPatchToJson(
  SystemOneSettingsPatch instance,
) => <String, dynamic>{
  'enabled': ?instance.enabled,
  'gate': ?_$SystemOneGateEnumMap[instance.gate],
};

RiskConfigPatch _$RiskConfigPatchFromJson(
  Map<String, dynamic> json,
) => RiskConfigPatch(
  maxRiskPerTradePct: (json['maxRiskPerTradePct'] as num?)?.toDouble(),
  maxPositionPct: (json['maxPositionPct'] as num?)?.toDouble(),
  maxSectorPct: (json['maxSectorPct'] as num?)?.toDouble(),
  maxPositions: (json['maxPositions'] as num?)?.toInt(),
  maxOrderNotionalUsd: (json['maxOrderNotionalUsd'] as num?)?.toDouble(),
  minOrderNotionalUsd: (json['minOrderNotionalUsd'] as num?)?.toDouble(),
  dailyLossHaltPct: (json['dailyLossHaltPct'] as num?)?.toDouble(),
  monthlyDrawdownHaltPct: (json['monthlyDrawdownHaltPct'] as num?)?.toDouble(),
  maxEntriesPerDay: (json['maxEntriesPerDay'] as num?)?.toInt(),
  minHoldDays: (json['minHoldDays'] as num?)?.toInt(),
  maxSpreadBps: (json['maxSpreadBps'] as num?)?.toDouble(),
  maxSlippageBps: (json['maxSlippageBps'] as num?)?.toDouble(),
  noTradeOpenMinutes: (json['noTradeOpenMinutes'] as num?)?.toInt(),
  noTradeCloseMinutes: (json['noTradeCloseMinutes'] as num?)?.toInt(),
  maxDayTrades5d: (json['maxDayTrades5d'] as num?)?.toInt(),
  minEvToCost: (json['minEvToCost'] as num?)?.toDouble(),
  earningsBlackoutDays: (json['earningsBlackoutDays'] as num?)?.toInt(),
  minAvgDollarVolumeUsd: (json['minAvgDollarVolumeUsd'] as num?)?.toDouble(),
);

Map<String, dynamic> _$RiskConfigPatchToJson(RiskConfigPatch instance) =>
    <String, dynamic>{
      'maxRiskPerTradePct': ?instance.maxRiskPerTradePct,
      'maxPositionPct': ?instance.maxPositionPct,
      'maxSectorPct': ?instance.maxSectorPct,
      'maxPositions': ?instance.maxPositions,
      'maxOrderNotionalUsd': ?instance.maxOrderNotionalUsd,
      'minOrderNotionalUsd': ?instance.minOrderNotionalUsd,
      'dailyLossHaltPct': ?instance.dailyLossHaltPct,
      'monthlyDrawdownHaltPct': ?instance.monthlyDrawdownHaltPct,
      'maxEntriesPerDay': ?instance.maxEntriesPerDay,
      'minHoldDays': ?instance.minHoldDays,
      'maxSpreadBps': ?instance.maxSpreadBps,
      'maxSlippageBps': ?instance.maxSlippageBps,
      'noTradeOpenMinutes': ?instance.noTradeOpenMinutes,
      'noTradeCloseMinutes': ?instance.noTradeCloseMinutes,
      'maxDayTrades5d': ?instance.maxDayTrades5d,
      'minEvToCost': ?instance.minEvToCost,
      'earningsBlackoutDays': ?instance.earningsBlackoutDays,
      'minAvgDollarVolumeUsd': ?instance.minAvgDollarVolumeUsd,
    };

SettingsPatch _$SettingsPatchFromJson(Map<String, dynamic> json) =>
    SettingsPatch(
      mode: $enumDecodeNullable(
        _$TradingModeEnumMap,
        json['mode'],
        unknownValue: TradingMode.off,
      ),
      killSwitch: json['killSwitch'] as bool?,
      drawdownHalted: json['drawdownHalted'] as bool?,
      drawdownHaltedMonth: json['drawdownHaltedMonth'] as String?,
      cycleMinutesOpen: (json['cycleMinutesOpen'] as num?)?.toInt(),
      cycleMinutesClosed: (json['cycleMinutesClosed'] as num?)?.toInt(),
      watchlist: (json['watchlist'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      risk: json['risk'] == null
          ? null
          : RiskConfigPatch.fromJson(json['risk'] as Map<String, dynamic>),
      systemOne: json['systemOne'] == null
          ? null
          : SystemOneSettingsPatch.fromJson(
              json['systemOne'] as Map<String, dynamic>,
            ),
    );

Map<String, dynamic> _$SettingsPatchToJson(SettingsPatch instance) =>
    <String, dynamic>{
      'mode': ?_$TradingModeEnumMap[instance.mode],
      'killSwitch': ?instance.killSwitch,
      'drawdownHalted': ?instance.drawdownHalted,
      'drawdownHaltedMonth': ?instance.drawdownHaltedMonth,
      'cycleMinutesOpen': ?instance.cycleMinutesOpen,
      'cycleMinutesClosed': ?instance.cycleMinutesClosed,
      'watchlist': ?instance.watchlist,
      'risk': ?instance.risk?.toJson(),
      'systemOne': ?instance.systemOne?.toJson(),
    };
