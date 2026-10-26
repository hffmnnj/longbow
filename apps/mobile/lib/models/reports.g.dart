// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'reports.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ReportSection _$ReportSectionFromJson(Map<String, dynamic> json) =>
    ReportSection(title: json['title'] as String, body: json['body'] as String);

ReportNarrative _$ReportNarrativeFromJson(Map<String, dynamic> json) =>
    ReportNarrative(
      kind: $enumDecode(
        _$ReportKindEnumMap,
        json['kind'],
        unknownValue: ReportKind.daily,
      ),
      symbol: json['symbol'] as String?,
      weekOf: json['weekOf'] as String?,
      headline: json['headline'] as String,
      summary: json['summary'] as String,
      grade: $enumDecodeNullable(
        _$ReportGradeEnumMap,
        json['grade'],
        unknownValue: ReportGrade.c,
      ),
      gradeReason: json['gradeReason'] as String?,
      sections: (json['sections'] as List<dynamic>)
          .map((e) => ReportSection.fromJson(e as Map<String, dynamic>))
          .toList(),
      lessons: (json['lessons'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      nextSteps: (json['nextSteps'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
    );

const _$ReportKindEnumMap = {
  ReportKind.daily: 'daily',
  ReportKind.weekly: 'weekly',
  ReportKind.trade: 'trade',
};

const _$ReportGradeEnumMap = {
  ReportGrade.a: 'A',
  ReportGrade.b: 'B',
  ReportGrade.c: 'C',
  ReportGrade.d: 'D',
  ReportGrade.f: 'F',
};

ReportOrderCounts _$ReportOrderCountsFromJson(Map<String, dynamic> json) =>
    ReportOrderCounts(
      submitted: (json['submitted'] as num).toInt(),
      filled: (json['filled'] as num).toInt(),
      rejected: (json['rejected'] as num).toInt(),
      cancelled: (json['cancelled'] as num).toInt(),
      failed: (json['failed'] as num).toInt(),
    );

ReportPosition _$ReportPositionFromJson(Map<String, dynamic> json) =>
    ReportPosition(
      symbol: json['symbol'] as String,
      weightPct: (json['weightPct'] as num).toDouble(),
      unrealizedPnl: (json['unrealizedPnl'] as num).toDouble(),
      sector: json['sector'] as String?,
    );

ReportDecision _$ReportDecisionFromJson(Map<String, dynamic> json) =>
    ReportDecision(
      id: json['id'] as String,
      at: (json['at'] as num).toInt(),
      action: $enumDecode(
        _$JournalActionEnumMap,
        json['action'],
        unknownValue: JournalAction.none,
      ),
      symbol: json['symbol'] as String?,
      summary: json['summary'] as String,
    );

const _$JournalActionEnumMap = {
  JournalAction.hold: 'hold',
  JournalAction.buy: 'buy',
  JournalAction.sell: 'sell',
  JournalAction.watch: 'watch',
  JournalAction.none: 'none',
};

ReportTradePlan _$ReportTradePlanFromJson(Map<String, dynamic> json) =>
    ReportTradePlan(
      thesis: json['thesis'] as String,
      invalidationPrice: (json['invalidationPrice'] as num).toDouble(),
      timeStopDate: json['timeStopDate'] as String,
      probabilityWin: (json['probabilityWin'] as num).toDouble(),
      expectedGainPct: (json['expectedGainPct'] as num).toDouble(),
      expectedLossPct: (json['expectedLossPct'] as num).toDouble(),
    );

ReportTradeFacts _$ReportTradeFactsFromJson(Map<String, dynamic> json) =>
    ReportTradeFacts(
      trade: ClosedTrade.fromJson(json['trade'] as Map<String, dynamic>),
      plan: json['plan'] == null
          ? null
          : ReportTradePlan.fromJson(json['plan'] as Map<String, dynamic>),
      entryOrderId: json['entryOrderId'] as String?,
      exitOrderId: json['exitOrderId'] as String?,
      bars: (json['bars'] as List<dynamic>)
          .map((e) => Bar.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

ReportFacts _$ReportFactsFromJson(Map<String, dynamic> json) => ReportFacts(
  periodStart: json['periodStart'] as String,
  periodEnd: json['periodEnd'] as String,
  startEquity: (json['startEquity'] as num?)?.toDouble(),
  endEquity: (json['endEquity'] as num?)?.toDouble(),
  pnl: (json['pnl'] as num?)?.toDouble(),
  pnlPct: (json['pnlPct'] as num?)?.toDouble(),
  benchmarkPct: (json['benchmarkPct'] as num?)?.toDouble(),
  equityCurve: (json['equityCurve'] as List<dynamic>)
      .map((e) => HoldingsReplayPoint.fromJson(e as Map<String, dynamic>))
      .toList(),
  trades: (json['trades'] as List<dynamic>)
      .map((e) => ClosedTrade.fromJson(e as Map<String, dynamic>))
      .toList(),
  realizedPnl: (json['realizedPnl'] as num).toDouble(),
  winRatePct: (json['winRatePct'] as num?)?.toDouble(),
  avgR: (json['avgR'] as num?)?.toDouble(),
  orders: ReportOrderCounts.fromJson(json['orders'] as Map<String, dynamic>),
  positions: (json['positions'] as List<dynamic>)
      .map((e) => ReportPosition.fromJson(e as Map<String, dynamic>))
      .toList(),
  heatPct: (json['heatPct'] as num?)?.toDouble(),
  decisions: (json['decisions'] as List<dynamic>)
      .map((e) => ReportDecision.fromJson(e as Map<String, dynamic>))
      .toList(),
  trade: json['trade'] == null
      ? null
      : ReportTradeFacts.fromJson(json['trade'] as Map<String, dynamic>),
);

ReportSummary _$ReportSummaryFromJson(Map<String, dynamic> json) =>
    ReportSummary(
      id: json['id'] as String,
      kind: $enumDecode(
        _$ReportKindEnumMap,
        json['kind'],
        unknownValue: ReportKind.daily,
      ),
      at: (json['at'] as num).toInt(),
      symbol: json['symbol'] as String?,
      periodStart: json['periodStart'] as String,
      periodEnd: json['periodEnd'] as String,
      headline: json['headline'] as String,
      grade: $enumDecodeNullable(
        _$ReportGradeEnumMap,
        json['grade'],
        unknownValue: ReportGrade.c,
      ),
      pnl: (json['pnl'] as num?)?.toDouble(),
      pnlPct: (json['pnlPct'] as num?)?.toDouble(),
    );

Report _$ReportFromJson(Map<String, dynamic> json) => Report(
  id: json['id'] as String,
  kind: $enumDecode(
    _$ReportKindEnumMap,
    json['kind'],
    unknownValue: ReportKind.daily,
  ),
  at: (json['at'] as num).toInt(),
  symbol: json['symbol'] as String?,
  periodStart: json['periodStart'] as String,
  periodEnd: json['periodEnd'] as String,
  headline: json['headline'] as String,
  grade: $enumDecodeNullable(
    _$ReportGradeEnumMap,
    json['grade'],
    unknownValue: ReportGrade.c,
  ),
  pnl: (json['pnl'] as num?)?.toDouble(),
  pnlPct: (json['pnlPct'] as num?)?.toDouble(),
  cycleId: json['cycleId'] as String?,
  narrative: ReportNarrative.fromJson(
    json['narrative'] as Map<String, dynamic>,
  ),
  facts: ReportFacts.fromJson(json['facts'] as Map<String, dynamic>),
);
