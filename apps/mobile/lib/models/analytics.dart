import 'package:json_annotation/json_annotation.dart';

part 'analytics.g.dart';

// Unknown ranges fall back to 3m, the app's default chart range.
enum AnalyticsRange {
  @JsonValue('1m')
  oneMonth,
  @JsonValue('3m')
  threeMonths,
  @JsonValue('1y')
  oneYear,
  @JsonValue('all')
  all,
}

// Unknown trade sources read as robinhood (older trades from broker history).
enum TradeSource {
  @JsonValue('harness')
  harness,
  @JsonValue('robinhood')
  robinhood,
}

// Unknown importance reads as medium.
enum CalendarImportance {
  @JsonValue('high')
  high,
  @JsonValue('medium')
  medium,
  @JsonValue('low')
  low,
}

@JsonSerializable(createToJson: false)
class EquityPoint {
  const EquityPoint({
    required this.at,
    required this.date,
    required this.equity,
    this.benchmark,
  });

  factory EquityPoint.fromJson(Map<String, dynamic> json) =>
      _$EquityPointFromJson(json);

  final int at;
  final String date;
  final double equity;

  /// SPY buy-and-hold scaled to the first point's equity.
  final double? benchmark;
}

/// One day of the holdings replay: what today's holdings plus today's cash
/// would have been worth on a past day.
@JsonSerializable(createToJson: false)
class HoldingsReplayPoint {
  const HoldingsReplayPoint({required this.date, required this.value});

  factory HoldingsReplayPoint.fromJson(Map<String, dynamic> json) =>
      _$HoldingsReplayPointFromJson(json);

  final String date;
  final double value;
}

@JsonSerializable(createToJson: false)
class EquityHistory {
  const EquityHistory({
    required this.points,
    required this.holdingsReplay,
    this.returnPct,
    this.benchmarkReturnPct,
    this.maxDrawdownPct,
  });

  factory EquityHistory.fromJson(Map<String, dynamic> json) =>
      _$EquityHistoryFromJson(json);

  /// Harness equity marks (recorded since the harness first connected), one ET
  /// day at most for ranges over 1m.
  final List<EquityPoint> points;

  /// What today's holdings plus today's cash would have been worth on each
  /// past day: a replay, not the account's real history.
  final List<HoldingsReplayPoint> holdingsReplay;
  final double? returnPct;
  final double? benchmarkReturnPct;
  final double? maxDrawdownPct;
}

@JsonSerializable(createToJson: false)
class ClosedTrade {
  const ClosedTrade({
    required this.symbol,
    this.openedAt,
    required this.closedAt,
    required this.quantity,
    this.entryPrice,
    required this.exitPrice,
    required this.pnl,
    this.pnlPct,
    this.fees,
    this.rMultiple,
    this.holdingDays,
    this.probabilityWin,
    required this.source,
  });

  factory ClosedTrade.fromJson(Map<String, dynamic> json) =>
      _$ClosedTradeFromJson(json);

  final String symbol;
  final int? openedAt;
  final int closedAt;
  final double quantity;
  final double? entryPrice;
  final double exitPrice;

  /// Realized P&L net of regulatory fees.
  final double pnl;
  final double? pnlPct;

  /// Regulatory fees on both legs, dollars, when known (harness trades); already subtracted from pnl.
  final double? fees;

  /// Realized P&L over planned risk (entry minus invalidation), for harness trades with a plan.
  final double? rMultiple;
  final double? holdingDays;

  /// The agent's stated probability of a win at entry, for harness trades.
  final double? probabilityWin;

  /// "harness" for trades this system opened, "robinhood" for older ones read from the broker's trade history.
  @JsonKey(unknownEnumValue: TradeSource.robinhood)
  final TradeSource source;
}

@JsonSerializable(createToJson: false)
class CalibrationBucket {
  const CalibrationBucket({
    required this.from,
    required this.to,
    required this.predicted,
    required this.realized,
    required this.count,
  });

  factory CalibrationBucket.fromJson(Map<String, dynamic> json) =>
      _$CalibrationBucketFromJson(json);

  /// Predicted win-probability bucket, for example 0.5 to 0.6.
  final double from;
  final double to;
  final double predicted;
  final double realized;
  final int count;
}

@JsonSerializable(createToJson: false)
class ExposureRow {
  const ExposureRow({
    required this.symbol,
    this.sector,
    required this.marketValue,
    required this.weightPct,
    required this.unrealizedPnl,
    this.stopPrice,
    this.riskToStopPct,
  });

  factory ExposureRow.fromJson(Map<String, dynamic> json) =>
      _$ExposureRowFromJson(json);

  final String symbol;
  final String? sector;
  final double marketValue;
  final double weightPct;
  final double unrealizedPnl;

  /// Stop price from a held stop, a Robinhood stop order, or the thesis invalidation.
  final double? stopPrice;

  /// Loss to the stop as a percent of equity.
  final double? riskToStopPct;
}

@JsonSerializable(createToJson: false)
class SectorWeight {
  const SectorWeight({required this.sector, required this.weightPct});

  factory SectorWeight.fromJson(Map<String, dynamic> json) =>
      _$SectorWeightFromJson(json);

  final String sector;
  final double weightPct;
}

@JsonSerializable(createToJson: false)
class PerformanceSummary {
  const PerformanceSummary({
    required this.trades,
    required this.realizedPnl,
    this.winRatePct,
    this.avgR,
    this.expectancy,
    this.profitFactor,
    this.avgHoldingDays,
    this.brier,
    required this.calibration,
    required this.exposure,
    required this.sectors,
    this.heatPct,
    required this.ordersByStatus,
  });

  factory PerformanceSummary.fromJson(Map<String, dynamic> json) =>
      _$PerformanceSummaryFromJson(json);

  final List<ClosedTrade> trades;
  final double realizedPnl;
  final double? winRatePct;
  final double? avgR;
  final double? expectancy;
  final double? profitFactor;
  final double? avgHoldingDays;
  final double? brier;
  final List<CalibrationBucket> calibration;
  final List<ExposureRow> exposure;
  final List<SectorWeight> sectors;

  /// Portfolio heat: total loss to all stops as a percent of equity.
  final double? heatPct;

  /// Counts keyed by wire status string; unknown future statuses stay visible as raw keys.
  final Map<String, int> ordersByStatus;
}

/// Returns, changes and relative strength are percents (1.5 means 1.5%), like
/// every *Pct field.
@JsonSerializable(createToJson: false)
class TrendRow {
  const TrendRow({
    required this.symbol,
    this.name,
    required this.last,
    required this.changePct1d,
    required this.return1m,
    required this.return3m,
    required this.aboveSma50,
    required this.aboveSma200,
    this.rsi14,
    this.relStrength3m,
    required this.spark,
  });

  factory TrendRow.fromJson(Map<String, dynamic> json) =>
      _$TrendRowFromJson(json);

  final String symbol;
  final String? name;
  final double last;
  final double changePct1d;
  final double return1m;
  final double return3m;
  final bool aboveSma50;
  final bool aboveSma200;
  final double? rsi14;

  /// 3-month return minus SPY's.
  final double? relStrength3m;

  /// Last 60 daily closes, oldest first.
  final List<double> spark;
}

@JsonSerializable(createToJson: false)
class VolatilityHistoryPoint {
  const VolatilityHistoryPoint({required this.date, required this.value});

  factory VolatilityHistoryPoint.fromJson(Map<String, dynamic> json) =>
      _$VolatilityHistoryPointFromJson(json);

  final String date;
  final double value;
}

@JsonSerializable(createToJson: false)
class VolatilityInfo {
  const VolatilityInfo({
    required this.vix,
    this.vix9d,
    this.vix3m,
    this.percentile,
    required this.contango,
    required this.history,
  });

  factory VolatilityInfo.fromJson(Map<String, dynamic> json) =>
      _$VolatilityInfoFromJson(json);

  final double vix;
  final double? vix9d;
  final double? vix3m;

  /// Percentile of today's VIX over the past year.
  final double? percentile;
  final bool contango;
  final List<VolatilityHistoryPoint> history;
}

@JsonSerializable(createToJson: false)
class YieldPoint {
  const YieldPoint({required this.tenor, required this.yieldPct});

  factory YieldPoint.fromJson(Map<String, dynamic> json) =>
      _$YieldPointFromJson(json);

  final String tenor;
  final double yieldPct;
}

@JsonSerializable(createToJson: false)
class TenYearHistoryPoint {
  const TenYearHistoryPoint({required this.date, required this.value});

  factory TenYearHistoryPoint.fromJson(Map<String, dynamic> json) =>
      _$TenYearHistoryPointFromJson(json);

  final String date;
  final double value;
}

@JsonSerializable(createToJson: false)
class BreadthInfo {
  const BreadthInfo({required this.aboveSma50, required this.total});

  factory BreadthInfo.fromJson(Map<String, dynamic> json) =>
      _$BreadthInfoFromJson(json);

  final int aboveSma50;
  final int total;
}

/// Economic calendar entry for the next 7 days.
@JsonSerializable(createToJson: false)
class CalendarEvent {
  const CalendarEvent({required this.date, this.time, required this.event, this.importance});

  factory CalendarEvent.fromJson(Map<String, dynamic> json) =>
      _$CalendarEventFromJson(json);

  final String date;
  final String? time;
  final String event;
  @JsonKey(unknownEnumValue: CalendarImportance.medium)
  final CalendarImportance? importance;
}

/// Earnings in the next 30 days for held and watchlist names.
@JsonSerializable(createToJson: false)
class EarningsEvent {
  const EarningsEvent({
    required this.symbol,
    required this.date,
    this.time,
    required this.held,
  });

  factory EarningsEvent.fromJson(Map<String, dynamic> json) =>
      _$EarningsEventFromJson(json);

  final String symbol;
  final String date;
  final String? time;
  final bool held;
}

@JsonSerializable(createToJson: false)
class MarketOverview {
  const MarketOverview({
    required this.asOf,
    required this.regime,
    required this.indices,
    required this.sectors,
    required this.volatility,
    required this.yields,
    required this.tenYearHistory,
    required this.breadth,
    required this.calendar,
    required this.earnings,
  });

  factory MarketOverview.fromJson(Map<String, dynamic> json) =>
      _$MarketOverviewFromJson(json);

  final int asOf;

  /// One-line regime label such as "Sideways, elevated volatility", from the same rules as the market-regime skill.
  final String regime;
  final List<TrendRow> indices;
  final List<TrendRow> sectors;
  final VolatilityInfo volatility;

  /// Treasury curve, short to long tenor.
  final List<YieldPoint> yields;
  final List<TenYearHistoryPoint> tenYearHistory;
  final BreadthInfo breadth;

  /// Economic calendar for the next 7 days.
  final List<CalendarEvent> calendar;

  /// Earnings in the next 30 days for held and watchlist names.
  final List<EarningsEvent> earnings;
}
