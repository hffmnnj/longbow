import 'package:json_annotation/json_annotation.dart';

part 'settings.g.dart';

// Unknown modes parse as off: research only, never orders.
enum TradingMode {
  @JsonValue('off')
  off,
  @JsonValue('approve')
  approve,
  @JsonValue('auto')
  auto,
}

@JsonSerializable(createToJson: false)
class RiskConfig {
  const RiskConfig({
    required this.maxRiskPerTradePct,
    required this.maxPositionPct,
    required this.maxSectorPct,
    required this.maxPositions,
    required this.maxOrderNotionalUsd,
    required this.minOrderNotionalUsd,
    required this.dailyLossHaltPct,
    required this.monthlyDrawdownHaltPct,
    required this.maxEntriesPerDay,
    required this.minHoldDays,
    required this.maxSpreadBps,
    required this.maxSlippageBps,
    required this.noTradeOpenMinutes,
    required this.noTradeCloseMinutes,
    required this.maxDayTrades5d,
    required this.minEvToCost,
    required this.earningsBlackoutDays,
    required this.minAvgDollarVolumeUsd,
  });

  factory RiskConfig.fromJson(Map<String, dynamic> json) =>
      _$RiskConfigFromJson(json);

  final double maxRiskPerTradePct;
  final double maxPositionPct;
  final double maxSectorPct;
  final int maxPositions;
  final double maxOrderNotionalUsd;
  final double minOrderNotionalUsd;
  final double dailyLossHaltPct;
  final double monthlyDrawdownHaltPct;
  final int maxEntriesPerDay;
  final int minHoldDays;
  final double maxSpreadBps;
  final double maxSlippageBps;
  final int noTradeOpenMinutes;
  final int noTradeCloseMinutes;
  final int maxDayTrades5d;
  final double minEvToCost;
  final int earningsBlackoutDays;
  final double minAvgDollarVolumeUsd;
}

/// Tuned for a small (about $1,200) cash account trading fractional shares of
/// liquid ETFs and mega caps. Mirrors TS DEFAULT_RISK.
const defaultRisk = RiskConfig(
  maxRiskPerTradePct: 1.5,
  maxPositionPct: 30,
  maxSectorPct: 60,
  maxPositions: 4,
  maxOrderNotionalUsd: 500,
  minOrderNotionalUsd: 5,
  dailyLossHaltPct: 3,
  monthlyDrawdownHaltPct: 8,
  maxEntriesPerDay: 2,
  minHoldDays: 1,
  maxSpreadBps: 20,
  maxSlippageBps: 10,
  noTradeOpenMinutes: 30,
  noTradeCloseMinutes: 15,
  maxDayTrades5d: 3,
  minEvToCost: 2,
  earningsBlackoutDays: 5,
  minAvgDollarVolumeUsd: 20000000,
);

@JsonSerializable(createToJson: false)
class Settings {
  const Settings({
    required this.mode,
    required this.killSwitch,
    required this.drawdownHalted,
    this.drawdownHaltedMonth,
    required this.cycleMinutesOpen,
    required this.cycleMinutesClosed,
    required this.watchlist,
    required this.risk,
  });

  factory Settings.fromJson(Map<String, dynamic> json) =>
      _$SettingsFromJson(json);

  @JsonKey(unknownEnumValue: TradingMode.off)
  final TradingMode mode;
  final bool killSwitch;
  final bool drawdownHalted;
  final String? drawdownHaltedMonth;
  final int cycleMinutesOpen;
  final int cycleMinutesClosed;
  final List<String> watchlist;
  final RiskConfig risk;

  Settings copyWith({
    TradingMode? mode,
    bool? killSwitch,
    bool? drawdownHalted,
    String? drawdownHaltedMonth,
    int? cycleMinutesOpen,
    int? cycleMinutesClosed,
    List<String>? watchlist,
    RiskConfig? risk,
  }) {
    return Settings(
      mode: mode ?? this.mode,
      killSwitch: killSwitch ?? this.killSwitch,
      drawdownHalted: drawdownHalted ?? this.drawdownHalted,
      drawdownHaltedMonth: drawdownHaltedMonth ?? this.drawdownHaltedMonth,
      cycleMinutesOpen: cycleMinutesOpen ?? this.cycleMinutesOpen,
      cycleMinutesClosed: cycleMinutesClosed ?? this.cycleMinutesClosed,
      watchlist: watchlist ?? this.watchlist,
      risk: risk ?? this.risk,
    );
  }
}

/// Mirrors TS DEFAULT_SETTINGS.
const defaultSettings = Settings(
  mode: TradingMode.auto,
  killSwitch: false,
  drawdownHalted: false,
  cycleMinutesOpen: 30,
  cycleMinutesClosed: 240,
  watchlist: [
    'SPY',
    'QQQ',
    'IWM',
    'SMH',
    'XLK',
    'XLF',
    'XLE',
    'NVDA',
    'AAPL',
    'MSFT',
    'AMZN',
    'META',
    'GOOGL',
  ],
  risk: defaultRisk,
);

/// Field-by-field merge patch for RiskConfig. All fields are nullable so the
/// app only sends what changed.
@JsonSerializable(includeIfNull: false, explicitToJson: true)
class RiskConfigPatch {
  const RiskConfigPatch({
    this.maxRiskPerTradePct,
    this.maxPositionPct,
    this.maxSectorPct,
    this.maxPositions,
    this.maxOrderNotionalUsd,
    this.minOrderNotionalUsd,
    this.dailyLossHaltPct,
    this.monthlyDrawdownHaltPct,
    this.maxEntriesPerDay,
    this.minHoldDays,
    this.maxSpreadBps,
    this.maxSlippageBps,
    this.noTradeOpenMinutes,
    this.noTradeCloseMinutes,
    this.maxDayTrades5d,
    this.minEvToCost,
    this.earningsBlackoutDays,
    this.minAvgDollarVolumeUsd,
  });

  factory RiskConfigPatch.fromJson(Map<String, dynamic> json) =>
      _$RiskConfigPatchFromJson(json);

  Map<String, dynamic> toJson() => _$RiskConfigPatchToJson(this);

  final double? maxRiskPerTradePct;
  final double? maxPositionPct;
  final double? maxSectorPct;
  final int? maxPositions;
  final double? maxOrderNotionalUsd;
  final double? minOrderNotionalUsd;
  final double? dailyLossHaltPct;
  final double? monthlyDrawdownHaltPct;
  final int? maxEntriesPerDay;
  final int? minHoldDays;
  final double? maxSpreadBps;
  final double? maxSlippageBps;
  final int? noTradeOpenMinutes;
  final int? noTradeCloseMinutes;
  final int? maxDayTrades5d;
  final double? minEvToCost;
  final int? earningsBlackoutDays;
  final double? minAvgDollarVolumeUsd;
}

/// PATCH /api/settings body. `toJson` omits every unset (null) field and nests
/// `risk` only when present, so the server merges field by field.
@JsonSerializable(includeIfNull: false, explicitToJson: true)
class SettingsPatch {
  const SettingsPatch({
    this.mode,
    this.killSwitch,
    this.drawdownHalted,
    this.drawdownHaltedMonth,
    this.cycleMinutesOpen,
    this.cycleMinutesClosed,
    this.watchlist,
    this.risk,
  });

  factory SettingsPatch.fromJson(Map<String, dynamic> json) =>
      _$SettingsPatchFromJson(json);

  /// Serializes only the fields the caller set; nulls are omitted.
  Map<String, dynamic> toJson() => _$SettingsPatchToJson(this);

  @JsonKey(unknownEnumValue: TradingMode.off)
  final TradingMode? mode;
  final bool? killSwitch;
  final bool? drawdownHalted;
  final String? drawdownHaltedMonth;
  final int? cycleMinutesOpen;
  final int? cycleMinutesClosed;
  final List<String>? watchlist;
  final RiskConfigPatch? risk;
}
