import 'package:json_annotation/json_annotation.dart';

import 'account.dart';
import 'orders.dart';
import 'settings.dart';

part 'sim.g.dart';

// Unknown modes read as historical (real dates and tickers, no aliasing).
enum SimMode {
  @JsonValue('historical')
  historical,
  @JsonValue('blind')
  blind,
  @JsonValue('bootstrap')
  bootstrap,
}

// Unknown executions read as realistic (liquidity-based spreads and slippage).
enum SimExecution {
  @JsonValue('realistic')
  realistic,
  @JsonValue('ideal')
  ideal,
}

// Unknown regimes read as chop, the least assumptive market description.
enum SimRegime {
  @JsonValue('crash')
  crash,
  @JsonValue('bear')
  bear,
  @JsonValue('bull')
  bull,
  @JsonValue('chop')
  chop,
  @JsonValue('rotation')
  rotation,
  @JsonValue('shock')
  shock,
}

// Unknown run states read as failed: never mistake an unknown state for done.
enum SimRunStatus {
  @JsonValue('queued')
  queued,
  @JsonValue('running')
  running,
  @JsonValue('done')
  done,
  @JsonValue('failed')
  failed,
  @JsonValue('stopped')
  stopped,
}

// Unknown starters read as user; response-only, never grants agent powers.
enum StartedBy {
  @JsonValue('user')
  user,
  @JsonValue('agent')
  agent,
}

// Unknown models read as main (the lead model); response-only.
enum SimModel {
  @JsonValue('main')
  main,
  @JsonValue('subagent')
  subagent,
}

// Unknown suite scenario modes read as blind so memory of real events cannot help.
enum ScenarioMode {
  @JsonValue('historical')
  historical,
  @JsonValue('blind')
  blind,
}

/// A named historical regime from the scenario library (GET /api/sim/scenarios).
@JsonSerializable(createToJson: false)
class SimScenario {
  const SimScenario({
    required this.id,
    required this.name,
    required this.description,
    required this.startDate,
    required this.days,
    required this.regime,
  });

  factory SimScenario.fromJson(Map<String, dynamic> json) =>
      _$SimScenarioFromJson(json);

  final String id;
  final String name;

  /// One sentence on what the window tests.
  final String description;
  final String startDate;
  final int days;
  @JsonKey(unknownEnumValue: SimRegime.chop)
  final SimRegime regime;
}

@JsonSerializable(explicitToJson: true)
class SimRunConfig {
  const SimRunConfig({
    this.name,
    this.scenario,
    this.mode = SimMode.historical,
    this.execution = SimExecution.realistic,
    this.seed,
    this.model = SimModel.main,
    this.startDate,
    required this.days,
    required this.startingCash,
    required this.cyclesPerDay,
    this.watchlist,
    this.strategy,
    this.risk,
  });

  factory SimRunConfig.fromJson(Map<String, dynamic> json) =>
      _$SimRunConfigFromJson(json);

  Map<String, dynamic> toJson() => _$SimRunConfigToJson(this);

  final String? name;

  /// Scenario library id; supplies startDate and days unless they are given.
  final String? scenario;
  @JsonKey(unknownEnumValue: SimMode.historical)
  final SimMode mode;
  @JsonKey(unknownEnumValue: SimExecution.realistic)
  final SimExecution execution;

  /// Seeds the intraday path, aliases, price scales and bootstrap draws; random when omitted, recorded on the run.
  final int? seed;

  /// "main" runs the lead model, "subagent" the cheaper subagent model (useful for large suites).
  @JsonKey(unknownEnumValue: SimModel.main)
  final SimModel model;

  /// First simulated NYSE trading day (ET) of the source history; required for
  /// historical and blind unless a scenario is given; ignored by bootstrap.
  final String? startDate;

  /// Trading days to simulate.
  final int days;
  final double startingCash;

  /// 2: open check (10:15 ET) and close review (15:45 ET); 3 adds pre-open (09:00); 4 adds midday (12:30).
  final int cyclesPerDay;
  final List<String>? watchlist;

  /// Extra instructions for this run's agent, for testing a strategy hypothesis.
  final String? strategy;

  /// Overrides on the live risk settings for this run.
  final RiskConfigPatch? risk;
}

/// End-of-day marks; `benchmark` is SPY buy-and-hold scaled to the starting cash.
@JsonSerializable(createToJson: false)
class SimEquityPoint {
  const SimEquityPoint({
    required this.date,
    required this.equity,
    required this.cash,
    required this.benchmark,
  });

  factory SimEquityPoint.fromJson(Map<String, dynamic> json) =>
      _$SimEquityPointFromJson(json);

  final String date;
  final double equity;
  final double cash;
  final double benchmark;
}

@JsonSerializable(createToJson: false)
class SimFill {
  const SimFill({
    required this.at,
    required this.date,
    required this.symbol,
    required this.side,
    required this.quantity,
    required this.price,
    required this.orderId,
    this.mid,
    this.cost,
    this.fees,
  });

  factory SimFill.fromJson(Map<String, dynamic> json) =>
      _$SimFillFromJson(json);

  final int at;
  final String date;
  final String symbol;
  @JsonKey(unknownEnumValue: OrderSide.buy)
  final OrderSide side;
  final double quantity;
  final double price;
  final String orderId;

  /// Mid price when the fill happened.
  final double? mid;

  /// Dollars paid versus the mid: half-spread plus slippage (always >= 0 in realistic execution).
  final double? cost;

  /// Regulatory fees charged on this fill (SEC, FINRA TAF, CAT), dollars; deducted from cash.
  final double? fees;
}

@JsonSerializable(createToJson: false)
class SimMetrics {
  const SimMetrics({
    required this.returnPct,
    required this.benchmarkReturnPct,
    required this.maxDrawdownPct,
    this.sharpe,
    required this.trades,
    this.winRatePct,
    this.avgR,
    required this.exposurePct,
    required this.ordersSubmitted,
    required this.ordersRejected,
    this.brier,
    this.sortino,
    this.calmar,
    this.volatilityPct,
    this.beta,
    this.alphaPct,
    required this.roundTrips,
    this.profitFactor,
    this.expectancy,
    this.avgHoldingDays,
    this.maxConsecutiveLosses,
    required this.turnoverPct,
    required this.costsPaid,
    required this.costsPct,
    required this.riskBlocks,
    this.feesPaid,
  });

  factory SimMetrics.fromJson(Map<String, dynamic> json) =>
      _$SimMetricsFromJson(json);

  final double returnPct;
  final double benchmarkReturnPct;
  final double maxDrawdownPct;

  /// Annualized from daily returns; absent under 5 days.
  final double? sharpe;
  final int trades;

  /// Closed round trips that made money, percent.
  final double? winRatePct;

  /// Average multiple of initial risk on closed round trips.
  final double? avgR;

  /// Average share of equity invested at the close.
  final double exposurePct;
  final int ordersSubmitted;
  final int ordersRejected;

  /// Brier score of entry `probabilityWin` against closed outcomes; lower is better.
  final double? brier;

  /// Annualized, from daily returns; absent under 5 days.
  final double? sortino;

  /// Annualized return over max drawdown; absent without a drawdown.
  final double? calmar;

  /// Annualized volatility of daily returns, percent.
  final double? volatilityPct;

  /// Beta of daily returns to the benchmark.
  final double? beta;

  /// Return minus beta times the benchmark's return over the run, percent.
  final double? alphaPct;

  /// Closed round trips. Runs stored before this metric existed omit it, so it defaults to 0.
  @JsonKey(defaultValue: 0)
  final int roundTrips;

  /// Gross profit over gross loss on closed round trips.
  final double? profitFactor;

  /// Average dollars per closed round trip.
  final double? expectancy;
  final double? avgHoldingDays;
  final int? maxConsecutiveLosses;

  /// Traded notional over average equity, percent.
  @JsonKey(defaultValue: 0)
  final double turnoverPct;

  /// Spread, slippage and regulatory fees paid, dollars and percent of starting cash.
  @JsonKey(defaultValue: 0)
  final double costsPaid;
  @JsonKey(defaultValue: 0)
  final double costsPct;

  /// Risk-engine rejections by rule, for example { sector: 2, max_positions: 1 }.
  @JsonKey(defaultValue: <String, int>{})
  final Map<String, int> riskBlocks;

  /// Regulatory fees alone, dollars (included in costsPaid).
  final double? feesPaid;
}

@JsonSerializable(createToJson: false)
class SimProgress {
  const SimProgress({
    required this.day,
    required this.days,
    required this.cycle,
    required this.cyclesPerDay,
  });

  factory SimProgress.fromJson(Map<String, dynamic> json) =>
      _$SimProgressFromJson(json);

  final int day;
  final int days;
  final int cycle;
  final int cyclesPerDay;
}

/// For blind and bootstrap runs: the fictional calendar's first day and the
/// source window it maps from.
@JsonSerializable(createToJson: false)
class SimCalendar {
  const SimCalendar({required this.firstDay, this.sourceStart, this.sourceEnd});

  factory SimCalendar.fromJson(Map<String, dynamic> json) =>
      _$SimCalendarFromJson(json);

  final String firstDay;
  final String? sourceStart;
  final String? sourceEnd;
}

@JsonSerializable(createToJson: false)
class SimRun {
  const SimRun({
    required this.id,
    required this.createdAt,
    required this.startedBy,
    required this.config,
    this.seed,
    this.aliases,
    this.calendar,
    this.suiteId,
    this.variant,
    required this.status,
    this.currentDate,
    required this.progress,
    required this.equity,
    required this.positions,
    required this.fills,
    this.metrics,
    this.error,
    this.finishedAt,
  });

  factory SimRun.fromJson(Map<String, dynamic> json) => _$SimRunFromJson(json);

  final String id;
  final int createdAt;
  @JsonKey(unknownEnumValue: StartedBy.user)
  final StartedBy startedBy;
  final SimRunConfig config;

  /// The seed actually used.
  final int? seed;

  /// For blind and bootstrap runs: alias to real symbol (bootstrap: the source
  /// symbol), filled in only when the run ends.
  final Map<String, String>? aliases;
  final SimCalendar? calendar;
  final String? suiteId;

  /// Suite variant label, for example "A".
  final String? variant;
  @JsonKey(unknownEnumValue: SimRunStatus.failed)
  final SimRunStatus status;

  /// Simulated ET date currently running.
  final String? currentDate;
  final SimProgress progress;
  final List<SimEquityPoint> equity;
  final List<Position> positions;
  final List<SimFill> fills;
  final SimMetrics? metrics;
  final String? error;
  final int? finishedAt;

  SimRun copyWith({
    String? id,
    int? createdAt,
    StartedBy? startedBy,
    SimRunConfig? config,
    int? seed,
    Map<String, String>? aliases,
    SimCalendar? calendar,
    String? suiteId,
    String? variant,
    SimRunStatus? status,
    String? currentDate,
    SimProgress? progress,
    List<SimEquityPoint>? equity,
    List<Position>? positions,
    List<SimFill>? fills,
    SimMetrics? metrics,
    String? error,
    int? finishedAt,
  }) {
    return SimRun(
      id: id ?? this.id,
      createdAt: createdAt ?? this.createdAt,
      startedBy: startedBy ?? this.startedBy,
      config: config ?? this.config,
      seed: seed ?? this.seed,
      aliases: aliases ?? this.aliases,
      calendar: calendar ?? this.calendar,
      suiteId: suiteId ?? this.suiteId,
      variant: variant ?? this.variant,
      status: status ?? this.status,
      currentDate: currentDate ?? this.currentDate,
      progress: progress ?? this.progress,
      equity: equity ?? this.equity,
      positions: positions ?? this.positions,
      fills: fills ?? this.fills,
      metrics: metrics ?? this.metrics,
      error: error ?? this.error,
      finishedAt: finishedAt ?? this.finishedAt,
    );
  }
}

@JsonSerializable(explicitToJson: true)
class SimVariant {
  const SimVariant({required this.label, this.strategy, this.risk, this.model});

  factory SimVariant.fromJson(Map<String, dynamic> json) =>
      _$SimVariantFromJson(json);

  Map<String, dynamic> toJson() => _$SimVariantToJson(this);

  final String label;
  final String? strategy;
  final RiskConfigPatch? risk;
  @JsonKey(unknownEnumValue: SimModel.main)
  final SimModel? model;
}

/// A batch: every variant runs on every scenario and every bootstrap seed, so
/// variants are compared on identical markets.
@JsonSerializable(explicitToJson: true)
class SimSuiteConfig {
  const SimSuiteConfig({
    required this.name,
    this.scenarios = const [],
    this.bootstrapRuns = 0,
    this.scenarioMode = ScenarioMode.blind,
    this.bootstrapDays = 40,
    required this.startingCash,
    this.cyclesPerDay = 2,
    this.execution = SimExecution.realistic,
    this.watchlist,
    required this.variants,
  });

  factory SimSuiteConfig.fromJson(Map<String, dynamic> json) =>
      _$SimSuiteConfigFromJson(json);

  Map<String, dynamic> toJson() => _$SimSuiteConfigToJson(this);

  final String name;
  final List<String> scenarios;

  /// Number of bootstrap markets (seeds 1..n).
  final int bootstrapRuns;

  /// Historical scenarios run blind (recommended) or historical.
  @JsonKey(unknownEnumValue: ScenarioMode.blind)
  final ScenarioMode scenarioMode;

  /// Bootstrap run length in trading days.
  final int bootstrapDays;
  final double startingCash;
  final int cyclesPerDay;
  @JsonKey(unknownEnumValue: SimExecution.realistic)
  final SimExecution execution;
  final List<String>? watchlist;
  final List<SimVariant> variants;
}

@JsonSerializable(createToJson: false)
class SimSuiteVariantSummary {
  const SimSuiteVariantSummary({
    required this.label,
    required this.runs,
    required this.done,
    required this.failed,
    this.meanReturnPct,
    this.medianReturnPct,
    this.p10ReturnPct,
    this.p90ReturnPct,
    this.meanExcessPct,
    this.beatBenchmarkPct,
    this.worstDrawdownPct,
    this.medianSharpe,
    this.winRatePct,
    this.avgR,
    this.costsPct,
    this.brier,
  });

  factory SimSuiteVariantSummary.fromJson(Map<String, dynamic> json) =>
      _$SimSuiteVariantSummaryFromJson(json);

  final String label;
  final int runs;
  final int done;
  final int failed;
  final double? meanReturnPct;
  final double? medianReturnPct;
  final double? p10ReturnPct;
  final double? p90ReturnPct;

  /// Mean of return minus benchmark return.
  final double? meanExcessPct;

  /// Share of finished runs that beat the benchmark, percent.
  final double? beatBenchmarkPct;
  final double? worstDrawdownPct;
  final double? medianSharpe;
  final double? winRatePct;
  final double? avgR;
  final double? costsPct;
  final double? brier;
}

@JsonSerializable(createToJson: false)
class SimSuiteRunEntry {
  const SimSuiteRunEntry({
    required this.runId,
    required this.variant,
    this.scenario,
    this.seed,
    required this.mode,
  });

  factory SimSuiteRunEntry.fromJson(Map<String, dynamic> json) =>
      _$SimSuiteRunEntryFromJson(json);

  final String runId;
  final String variant;
  final String? scenario;
  final int? seed;
  @JsonKey(unknownEnumValue: SimMode.historical)
  final SimMode mode;
}

/// With two variants: B minus A on excess return over paired markets, with a
/// bootstrap 95% interval.
@JsonSerializable(createToJson: false)
class SimComparison {
  const SimComparison({
    required this.metric,
    required this.meanDiff,
    required this.ci95,
    required this.pairs,
  });

  factory SimComparison.fromJson(Map<String, dynamic> json) =>
      _$SimComparisonFromJson(json);

  final String metric;
  final double meanDiff;
  final List<double> ci95;
  final int pairs;
}

@JsonSerializable(createToJson: false)
class SimSuite {
  const SimSuite({
    required this.id,
    required this.createdAt,
    required this.startedBy,
    required this.config,
    required this.status,
    required this.runs,
    required this.summary,
    this.comparison,
    this.finishedAt,
  });

  factory SimSuite.fromJson(Map<String, dynamic> json) =>
      _$SimSuiteFromJson(json);

  final String id;
  final int createdAt;
  @JsonKey(unknownEnumValue: StartedBy.user)
  final StartedBy startedBy;
  final SimSuiteConfig config;
  @JsonKey(unknownEnumValue: SimRunStatus.failed)
  final SimRunStatus status;
  final List<SimSuiteRunEntry> runs;
  final List<SimSuiteVariantSummary> summary;
  final SimComparison? comparison;
  final int? finishedAt;

  SimSuite copyWith({
    String? id,
    int? createdAt,
    StartedBy? startedBy,
    SimSuiteConfig? config,
    SimRunStatus? status,
    List<SimSuiteRunEntry>? runs,
    List<SimSuiteVariantSummary>? summary,
    SimComparison? comparison,
    int? finishedAt,
  }) {
    return SimSuite(
      id: id ?? this.id,
      createdAt: createdAt ?? this.createdAt,
      startedBy: startedBy ?? this.startedBy,
      config: config ?? this.config,
      status: status ?? this.status,
      runs: runs ?? this.runs,
      summary: summary ?? this.summary,
      comparison: comparison ?? this.comparison,
      finishedAt: finishedAt ?? this.finishedAt,
    );
  }
}
