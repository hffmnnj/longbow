// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'analytics.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EquityPoint _$EquityPointFromJson(Map<String, dynamic> json) => EquityPoint(
  at: (json['at'] as num).toInt(),
  date: json['date'] as String,
  equity: (json['equity'] as num).toDouble(),
  benchmark: (json['benchmark'] as num?)?.toDouble(),
);

HoldingsReplayPoint _$HoldingsReplayPointFromJson(Map<String, dynamic> json) =>
    HoldingsReplayPoint(
      date: json['date'] as String,
      value: (json['value'] as num).toDouble(),
    );

EquityHistory _$EquityHistoryFromJson(Map<String, dynamic> json) =>
    EquityHistory(
      points: (json['points'] as List<dynamic>)
          .map((e) => EquityPoint.fromJson(e as Map<String, dynamic>))
          .toList(),
      holdingsReplay: (json['holdingsReplay'] as List<dynamic>)
          .map((e) => HoldingsReplayPoint.fromJson(e as Map<String, dynamic>))
          .toList(),
      returnPct: (json['returnPct'] as num?)?.toDouble(),
      benchmarkReturnPct: (json['benchmarkReturnPct'] as num?)?.toDouble(),
      maxDrawdownPct: (json['maxDrawdownPct'] as num?)?.toDouble(),
    );

ClosedTrade _$ClosedTradeFromJson(Map<String, dynamic> json) => ClosedTrade(
  symbol: json['symbol'] as String,
  openedAt: (json['openedAt'] as num?)?.toInt(),
  closedAt: (json['closedAt'] as num).toInt(),
  quantity: (json['quantity'] as num).toDouble(),
  entryPrice: (json['entryPrice'] as num?)?.toDouble(),
  exitPrice: (json['exitPrice'] as num).toDouble(),
  pnl: (json['pnl'] as num).toDouble(),
  pnlPct: (json['pnlPct'] as num?)?.toDouble(),
  fees: (json['fees'] as num?)?.toDouble(),
  rMultiple: (json['rMultiple'] as num?)?.toDouble(),
  holdingDays: (json['holdingDays'] as num?)?.toDouble(),
  probabilityWin: (json['probabilityWin'] as num?)?.toDouble(),
  source: $enumDecode(
    _$TradeSourceEnumMap,
    json['source'],
    unknownValue: TradeSource.robinhood,
  ),
);

const _$TradeSourceEnumMap = {
  TradeSource.harness: 'harness',
  TradeSource.robinhood: 'robinhood',
};

CalibrationBucket _$CalibrationBucketFromJson(Map<String, dynamic> json) =>
    CalibrationBucket(
      from: (json['from'] as num).toDouble(),
      to: (json['to'] as num).toDouble(),
      predicted: (json['predicted'] as num).toDouble(),
      realized: (json['realized'] as num).toDouble(),
      count: (json['count'] as num).toInt(),
    );

ExposureRow _$ExposureRowFromJson(Map<String, dynamic> json) => ExposureRow(
  symbol: json['symbol'] as String,
  sector: json['sector'] as String?,
  marketValue: (json['marketValue'] as num).toDouble(),
  weightPct: (json['weightPct'] as num).toDouble(),
  unrealizedPnl: (json['unrealizedPnl'] as num).toDouble(),
  stopPrice: (json['stopPrice'] as num?)?.toDouble(),
  riskToStopPct: (json['riskToStopPct'] as num?)?.toDouble(),
);

SectorWeight _$SectorWeightFromJson(Map<String, dynamic> json) => SectorWeight(
  sector: json['sector'] as String,
  weightPct: (json['weightPct'] as num).toDouble(),
);

PerformanceSummary _$PerformanceSummaryFromJson(Map<String, dynamic> json) =>
    PerformanceSummary(
      trades: (json['trades'] as List<dynamic>)
          .map((e) => ClosedTrade.fromJson(e as Map<String, dynamic>))
          .toList(),
      realizedPnl: (json['realizedPnl'] as num).toDouble(),
      winRatePct: (json['winRatePct'] as num?)?.toDouble(),
      avgR: (json['avgR'] as num?)?.toDouble(),
      expectancy: (json['expectancy'] as num?)?.toDouble(),
      profitFactor: (json['profitFactor'] as num?)?.toDouble(),
      avgHoldingDays: (json['avgHoldingDays'] as num?)?.toDouble(),
      brier: (json['brier'] as num?)?.toDouble(),
      calibration: (json['calibration'] as List<dynamic>)
          .map((e) => CalibrationBucket.fromJson(e as Map<String, dynamic>))
          .toList(),
      exposure: (json['exposure'] as List<dynamic>)
          .map((e) => ExposureRow.fromJson(e as Map<String, dynamic>))
          .toList(),
      sectors: (json['sectors'] as List<dynamic>)
          .map((e) => SectorWeight.fromJson(e as Map<String, dynamic>))
          .toList(),
      heatPct: (json['heatPct'] as num?)?.toDouble(),
      ordersByStatus: Map<String, int>.from(json['ordersByStatus'] as Map),
    );

TrendRow _$TrendRowFromJson(Map<String, dynamic> json) => TrendRow(
  symbol: json['symbol'] as String,
  name: json['name'] as String?,
  last: (json['last'] as num).toDouble(),
  changePct1d: (json['changePct1d'] as num).toDouble(),
  return1m: (json['return1m'] as num).toDouble(),
  return3m: (json['return3m'] as num).toDouble(),
  aboveSma50: json['aboveSma50'] as bool,
  aboveSma200: json['aboveSma200'] as bool,
  rsi14: (json['rsi14'] as num?)?.toDouble(),
  relStrength3m: (json['relStrength3m'] as num?)?.toDouble(),
  spark: (json['spark'] as List<dynamic>)
      .map((e) => (e as num).toDouble())
      .toList(),
);

VolatilityHistoryPoint _$VolatilityHistoryPointFromJson(
  Map<String, dynamic> json,
) => VolatilityHistoryPoint(
  date: json['date'] as String,
  value: (json['value'] as num).toDouble(),
);

VolatilityInfo _$VolatilityInfoFromJson(Map<String, dynamic> json) =>
    VolatilityInfo(
      vix: (json['vix'] as num).toDouble(),
      vix9d: (json['vix9d'] as num?)?.toDouble(),
      vix3m: (json['vix3m'] as num?)?.toDouble(),
      percentile: (json['percentile'] as num?)?.toDouble(),
      contango: json['contango'] as bool,
      history: (json['history'] as List<dynamic>)
          .map(
            (e) => VolatilityHistoryPoint.fromJson(e as Map<String, dynamic>),
          )
          .toList(),
    );

YieldPoint _$YieldPointFromJson(Map<String, dynamic> json) => YieldPoint(
  tenor: json['tenor'] as String,
  yieldPct: (json['yieldPct'] as num).toDouble(),
);

TenYearHistoryPoint _$TenYearHistoryPointFromJson(Map<String, dynamic> json) =>
    TenYearHistoryPoint(
      date: json['date'] as String,
      value: (json['value'] as num).toDouble(),
    );

BreadthInfo _$BreadthInfoFromJson(Map<String, dynamic> json) => BreadthInfo(
  aboveSma50: (json['aboveSma50'] as num).toInt(),
  total: (json['total'] as num).toInt(),
);

CalendarEvent _$CalendarEventFromJson(Map<String, dynamic> json) =>
    CalendarEvent(
      date: json['date'] as String,
      time: json['time'] as String?,
      event: json['event'] as String,
      importance: $enumDecodeNullable(
        _$CalendarImportanceEnumMap,
        json['importance'],
        unknownValue: CalendarImportance.medium,
      ),
    );

const _$CalendarImportanceEnumMap = {
  CalendarImportance.high: 'high',
  CalendarImportance.medium: 'medium',
  CalendarImportance.low: 'low',
};

EarningsEvent _$EarningsEventFromJson(Map<String, dynamic> json) =>
    EarningsEvent(
      symbol: json['symbol'] as String,
      date: json['date'] as String,
      time: json['time'] as String?,
      held: json['held'] as bool,
    );

MarketOverview _$MarketOverviewFromJson(Map<String, dynamic> json) =>
    MarketOverview(
      asOf: (json['asOf'] as num).toInt(),
      regime: json['regime'] as String,
      indices: (json['indices'] as List<dynamic>)
          .map((e) => TrendRow.fromJson(e as Map<String, dynamic>))
          .toList(),
      sectors: (json['sectors'] as List<dynamic>)
          .map((e) => TrendRow.fromJson(e as Map<String, dynamic>))
          .toList(),
      volatility: VolatilityInfo.fromJson(
        json['volatility'] as Map<String, dynamic>,
      ),
      yields: (json['yields'] as List<dynamic>)
          .map((e) => YieldPoint.fromJson(e as Map<String, dynamic>))
          .toList(),
      tenYearHistory: (json['tenYearHistory'] as List<dynamic>)
          .map((e) => TenYearHistoryPoint.fromJson(e as Map<String, dynamic>))
          .toList(),
      breadth: BreadthInfo.fromJson(json['breadth'] as Map<String, dynamic>),
      calendar: (json['calendar'] as List<dynamic>)
          .map((e) => CalendarEvent.fromJson(e as Map<String, dynamic>))
          .toList(),
      earnings: (json['earnings'] as List<dynamic>)
          .map((e) => EarningsEvent.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
