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

// Unknown gates parse as advise: review without blocking.
enum SystemOneGate {
  @JsonValue('off')
  off,
  @JsonValue('advise')
  advise,
  @JsonValue('block')
  block,
}

/// System One (decision model) gate settings. Mirrors TS SystemOneSettings.
@JsonSerializable(createToJson: false)
class SystemOneSettings {
  const SystemOneSettings({required this.enabled, required this.gate});

  factory SystemOneSettings.fromJson(Map<String, dynamic> json) =>
      _$SystemOneSettingsFromJson(json);

  final bool enabled;
  @JsonKey(unknownEnumValue: SystemOneGate.advise)
  final SystemOneGate gate;
}

/// Older servers omit `systemOne`; the default reviews without blocking.
const defaultSystemOne = SystemOneSettings(
  enabled: true,
  gate: SystemOneGate.advise,
);

/// The crypto sleeve: a small, separately capped slice of the account.
/// Mirrors TS CryptoSettings in `packages/shared`.
@JsonSerializable(createToJson: false)
class CryptoSettings {
  const CryptoSettings({
    required this.enabled,
    required this.allowed,
    required this.maxPortfolioPct,
    required this.maxOrderNotionalUsd,
    required this.maxEntriesPerDay,
    required this.maxSpreadBps,
    required this.minRewardRisk,
  });

  factory CryptoSettings.fromJson(Map<String, dynamic> json) =>
      _$CryptoSettingsFromJson(json);

  final bool enabled;

  /// Pairs the agent may trade, such as BTC-USD.
  final List<String> allowed;

  /// Max market value of all crypto after an order, as % of equity.
  final double maxPortfolioPct;

  /// Fat-finger cap on one crypto order's notional.
  final double maxOrderNotionalUsd;

  /// Max crypto buys per ET day.
  final int maxEntriesPerDay;

  /// Max ask-bid spread in basis points of mid.
  final double maxSpreadBps;

  /// Entries need expectedGainPct / expectedLossPct at or above this.
  final double minRewardRisk;
}

/// Older servers omit `crypto`; the sleeve stays off until the server and the
/// user say otherwise. Numbers mirror TS DEFAULT_CRYPTO.
const defaultCrypto = CryptoSettings(
  enabled: false,
  allowed: ['BTC-USD', 'ETH-USD'],
  maxPortfolioPct: 8,
  maxOrderNotionalUsd: 40,
  maxEntriesPerDay: 1,
  maxSpreadBps: 300,
  minRewardRisk: 2,
);

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

/// Tuned for a small cash account trading fractional shares of
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
    this.systemOne = defaultSystemOne,
    this.crypto = defaultCrypto,
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

  /// Absent on servers older than System One; defaults to advise.
  final SystemOneSettings systemOne;

  /// Absent on servers older than the crypto sleeve; defaults to off.
  final CryptoSettings crypto;

  Settings copyWith({
    TradingMode? mode,
    bool? killSwitch,
    bool? drawdownHalted,
    String? drawdownHaltedMonth,
    int? cycleMinutesOpen,
    int? cycleMinutesClosed,
    List<String>? watchlist,
    RiskConfig? risk,
    SystemOneSettings? systemOne,
    CryptoSettings? crypto,
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
      systemOne: systemOne ?? this.systemOne,
      crypto: crypto ?? this.crypto,
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

/// Field-by-field merge patch for SystemOneSettings. Either field alone is
/// allowed; the server merges what is present.
@JsonSerializable(includeIfNull: false, explicitToJson: true)
class SystemOneSettingsPatch {
  const SystemOneSettingsPatch({this.enabled, this.gate});

  factory SystemOneSettingsPatch.fromJson(Map<String, dynamic> json) =>
      _$SystemOneSettingsPatchFromJson(json);

  Map<String, dynamic> toJson() => _$SystemOneSettingsPatchToJson(this);

  final bool? enabled;
  @JsonKey(unknownEnumValue: SystemOneGate.advise)
  final SystemOneGate? gate;
}

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

/// Field-by-field merge patch for CryptoSettings. Either field alone is
/// allowed; the server merges what is present.
@JsonSerializable(includeIfNull: false, explicitToJson: true)
class CryptoSettingsPatch {
  const CryptoSettingsPatch({
    this.enabled,
    this.allowed,
    this.maxPortfolioPct,
    this.maxOrderNotionalUsd,
    this.maxEntriesPerDay,
    this.maxSpreadBps,
    this.minRewardRisk,
  });

  factory CryptoSettingsPatch.fromJson(Map<String, dynamic> json) =>
      _$CryptoSettingsPatchFromJson(json);

  Map<String, dynamic> toJson() => _$CryptoSettingsPatchToJson(this);

  final bool? enabled;
  final List<String>? allowed;
  final double? maxPortfolioPct;
  final double? maxOrderNotionalUsd;
  final int? maxEntriesPerDay;
  final double? maxSpreadBps;
  final double? minRewardRisk;
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
    this.systemOne,
    this.crypto,
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
  final SystemOneSettingsPatch? systemOne;
  final CryptoSettingsPatch? crypto;
}
