import 'package:json_annotation/json_annotation.dart';

import 'analytics.dart';
import 'journal.dart';
import 'market.dart';

part 'reports.g.dart';

// Unknown kinds read as daily, the most common report.
enum ReportKind {
  @JsonValue('daily')
  daily,
  @JsonValue('weekly')
  weekly,
  @JsonValue('trade')
  trade,
}

/// Decision quality, judged apart from the outcome: a loss on a well-run plan
/// can earn an A. Unknown grades read as C (average, no signal).
enum ReportGrade {
  @JsonValue('A')
  a,
  @JsonValue('B')
  b,
  @JsonValue('C')
  c,
  @JsonValue('D')
  d,
  @JsonValue('F')
  f,
}

/// One short titled section of a report narrative.
@JsonSerializable(createToJson: false)
class ReportSection {
  const ReportSection({required this.title, required this.body});

  factory ReportSection.fromJson(Map<String, dynamic> json) =>
      _$ReportSectionFromJson(json);

  final String title;
  final String body;
}

/// What the agent submits through the `publish_report` tool.
@JsonSerializable(createToJson: false)
class ReportNarrative {
  const ReportNarrative({
    required this.kind,
    this.symbol,
    this.weekOf,
    required this.headline,
    required this.summary,
    this.grade,
    this.gradeReason,
    required this.sections,
    required this.lessons,
    required this.nextSteps,
  });

  factory ReportNarrative.fromJson(Map<String, dynamic> json) =>
      _$ReportNarrativeFromJson(json);

  @JsonKey(unknownEnumValue: ReportKind.daily)
  final ReportKind kind;

  /// Trade reports only: the closed symbol.
  final String? symbol;

  /// Weekly reports only: the Monday (ET date) of the week covered; defaults to the current week.
  final String? weekOf;

  /// One plain sentence, the first thing the owner reads.
  final String headline;

  /// Two to four sentences of markdown. The limits keep reports readable at a glance.
  final String summary;
  @JsonKey(unknownEnumValue: ReportGrade.c)
  final ReportGrade? grade;

  /// Why the grade, in one sentence.
  final String? gradeReason;

  /// Short titled sections in markdown, for example "What worked", "What didn't", "Market".
  final List<ReportSection> sections;
  final List<String> lessons;
  final List<String> nextSteps;
}

@JsonSerializable(createToJson: false)
class ReportOrderCounts {
  const ReportOrderCounts({
    required this.submitted,
    required this.filled,
    required this.rejected,
    required this.cancelled,
    required this.failed,
  });

  factory ReportOrderCounts.fromJson(Map<String, dynamic> json) =>
      _$ReportOrderCountsFromJson(json);

  final int submitted;
  final int filled;
  final int rejected;
  final int cancelled;
  final int failed;
}

@JsonSerializable(createToJson: false)
class ReportPosition {
  const ReportPosition({
    required this.symbol,
    required this.weightPct,
    required this.unrealizedPnl,
    this.sector,
  });

  factory ReportPosition.fromJson(Map<String, dynamic> json) =>
      _$ReportPositionFromJson(json);

  final String symbol;
  final double weightPct;
  final double unrealizedPnl;
  final String? sector;
}

@JsonSerializable(createToJson: false)
class ReportDecision {
  const ReportDecision({
    required this.id,
    required this.at,
    required this.action,
    this.symbol,
    required this.summary,
  });

  factory ReportDecision.fromJson(Map<String, dynamic> json) =>
      _$ReportDecisionFromJson(json);

  final String id;
  final int at;
  @JsonKey(unknownEnumValue: JournalAction.none)
  final JournalAction action;
  final String? symbol;
  final String summary;
}

/// The entry order's plan as submitted (subset of OrderIntent).
@JsonSerializable(createToJson: false)
class ReportTradePlan {
  const ReportTradePlan({
    required this.thesis,
    required this.invalidationPrice,
    required this.timeStopDate,
    required this.probabilityWin,
    required this.expectedGainPct,
    required this.expectedLossPct,
  });

  factory ReportTradePlan.fromJson(Map<String, dynamic> json) =>
      _$ReportTradePlanFromJson(json);

  final String thesis;
  final double invalidationPrice;
  final String timeStopDate;
  final double probabilityWin;
  final double expectedGainPct;
  final double expectedLossPct;
}

/// Trade-report-only detail: the closed trade plus its plan and price path.
@JsonSerializable(createToJson: false)
class ReportTradeFacts {
  const ReportTradeFacts({
    required this.trade,
    this.plan,
    this.entryOrderId,
    this.exitOrderId,
    required this.bars,
  });

  factory ReportTradeFacts.fromJson(Map<String, dynamic> json) =>
      _$ReportTradeFactsFromJson(json);

  final ClosedTrade trade;

  /// The entry order's plan as submitted.
  final ReportTradePlan? plan;
  final String? entryOrderId;
  final String? exitOrderId;

  /// Daily bars from 20 trading days before entry to 5 after exit, for the price-path chart.
  final List<Bar> bars;
}

/// Server-computed figures for the report's period; never written by the model.
@JsonSerializable(createToJson: false)
class ReportFacts {
  const ReportFacts({
    required this.periodStart,
    required this.periodEnd,
    this.startEquity,
    this.endEquity,
    this.pnl,
    this.pnlPct,
    this.benchmarkPct,
    required this.equityCurve,
    required this.trades,
    required this.realizedPnl,
    this.winRatePct,
    this.avgR,
    required this.orders,
    required this.positions,
    this.heatPct,
    required this.decisions,
    this.trade,
  });

  factory ReportFacts.fromJson(Map<String, dynamic> json) =>
      _$ReportFactsFromJson(json);

  /// ET dates, inclusive. A trade report spans entry to exit.
  final String periodStart;
  final String periodEnd;
  final double? startEquity;
  final double? endEquity;

  /// The account's P&L over the period; for a trade report, the trade's own realized P&L.
  final double? pnl;
  final double? pnlPct;

  /// SPY's percent change over the same period.
  final double? benchmarkPct;

  /// Daily equity marks in the period (dayLast), oldest first.
  final List<HoldingsReplayPoint> equityCurve;

  /// Trades closed in the period.
  final List<ClosedTrade> trades;
  final double realizedPnl;
  final double? winRatePct;
  final double? avgR;
  final ReportOrderCounts orders;

  /// Holdings at the end of the period.
  final List<ReportPosition> positions;
  final double? heatPct;

  /// The decisions journaled in the period, newest first, at most 20.
  final List<ReportDecision> decisions;

  /// Trade reports only.
  final ReportTradeFacts? trade;
}

@JsonSerializable(createToJson: false)
class ReportSummary {
  const ReportSummary({
    required this.id,
    required this.kind,
    required this.at,
    this.symbol,
    required this.periodStart,
    required this.periodEnd,
    required this.headline,
    this.grade,
    this.pnl,
    this.pnlPct,
  });

  factory ReportSummary.fromJson(Map<String, dynamic> json) =>
      _$ReportSummaryFromJson(json);

  final String id;
  @JsonKey(unknownEnumValue: ReportKind.daily)
  final ReportKind kind;
  final int at;

  /// Trade reports: the symbol.
  final String? symbol;
  final String periodStart;
  final String periodEnd;
  final String headline;
  @JsonKey(unknownEnumValue: ReportGrade.c)
  final ReportGrade? grade;
  final double? pnl;
  final double? pnlPct;
}

@JsonSerializable(createToJson: false)
class Report {
  const Report({
    required this.id,
    required this.kind,
    required this.at,
    this.symbol,
    required this.periodStart,
    required this.periodEnd,
    required this.headline,
    this.grade,
    this.pnl,
    this.pnlPct,
    this.cycleId,
    required this.narrative,
    required this.facts,
  });

  factory Report.fromJson(Map<String, dynamic> json) => _$ReportFromJson(json);

  final String id;
  @JsonKey(unknownEnumValue: ReportKind.daily)
  final ReportKind kind;
  final int at;

  /// Trade reports: the symbol.
  final String? symbol;
  final String periodStart;
  final String periodEnd;
  final String headline;
  @JsonKey(unknownEnumValue: ReportGrade.c)
  final ReportGrade? grade;
  final double? pnl;
  final double? pnlPct;
  final String? cycleId;
  final ReportNarrative narrative;
  final ReportFacts facts;
}
