// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sim.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SimScenario _$SimScenarioFromJson(Map<String, dynamic> json) => SimScenario(
  id: json['id'] as String,
  name: json['name'] as String,
  description: json['description'] as String,
  startDate: json['startDate'] as String,
  days: (json['days'] as num).toInt(),
  regime: $enumDecode(
    _$SimRegimeEnumMap,
    json['regime'],
    unknownValue: SimRegime.chop,
  ),
);

const _$SimRegimeEnumMap = {
  SimRegime.crash: 'crash',
  SimRegime.bear: 'bear',
  SimRegime.bull: 'bull',
  SimRegime.chop: 'chop',
  SimRegime.rotation: 'rotation',
  SimRegime.shock: 'shock',
};

SimRunConfig _$SimRunConfigFromJson(Map<String, dynamic> json) => SimRunConfig(
  name: json['name'] as String?,
  scenario: json['scenario'] as String?,
  mode:
      $enumDecodeNullable(
        _$SimModeEnumMap,
        json['mode'],
        unknownValue: SimMode.historical,
      ) ??
      SimMode.historical,
  execution:
      $enumDecodeNullable(
        _$SimExecutionEnumMap,
        json['execution'],
        unknownValue: SimExecution.realistic,
      ) ??
      SimExecution.realistic,
  seed: (json['seed'] as num?)?.toInt(),
  model:
      $enumDecodeNullable(
        _$SimModelEnumMap,
        json['model'],
        unknownValue: SimModel.main,
      ) ??
      SimModel.main,
  startDate: json['startDate'] as String?,
  days: (json['days'] as num).toInt(),
  startingCash: (json['startingCash'] as num).toDouble(),
  cyclesPerDay: (json['cyclesPerDay'] as num).toInt(),
  watchlist: (json['watchlist'] as List<dynamic>?)
      ?.map((e) => e as String)
      .toList(),
  strategy: json['strategy'] as String?,
  risk: json['risk'] == null
      ? null
      : RiskConfigPatch.fromJson(json['risk'] as Map<String, dynamic>),
);

Map<String, dynamic> _$SimRunConfigToJson(SimRunConfig instance) =>
    <String, dynamic>{
      'name': instance.name,
      'scenario': instance.scenario,
      'mode': _$SimModeEnumMap[instance.mode]!,
      'execution': _$SimExecutionEnumMap[instance.execution]!,
      'seed': instance.seed,
      'model': _$SimModelEnumMap[instance.model]!,
      'startDate': instance.startDate,
      'days': instance.days,
      'startingCash': instance.startingCash,
      'cyclesPerDay': instance.cyclesPerDay,
      'watchlist': instance.watchlist,
      'strategy': instance.strategy,
      'risk': instance.risk?.toJson(),
    };

const _$SimModeEnumMap = {
  SimMode.historical: 'historical',
  SimMode.blind: 'blind',
  SimMode.bootstrap: 'bootstrap',
};

const _$SimExecutionEnumMap = {
  SimExecution.realistic: 'realistic',
  SimExecution.ideal: 'ideal',
};

const _$SimModelEnumMap = {
  SimModel.main: 'main',
  SimModel.subagent: 'subagent',
};

SimEquityPoint _$SimEquityPointFromJson(Map<String, dynamic> json) =>
    SimEquityPoint(
      date: json['date'] as String,
      equity: (json['equity'] as num).toDouble(),
      cash: (json['cash'] as num).toDouble(),
      benchmark: (json['benchmark'] as num).toDouble(),
    );

SimFill _$SimFillFromJson(Map<String, dynamic> json) => SimFill(
  at: (json['at'] as num).toInt(),
  date: json['date'] as String,
  symbol: json['symbol'] as String,
  side: $enumDecode(
    _$OrderSideEnumMap,
    json['side'],
    unknownValue: OrderSide.buy,
  ),
  quantity: (json['quantity'] as num).toDouble(),
  price: (json['price'] as num).toDouble(),
  orderId: json['orderId'] as String,
  mid: (json['mid'] as num?)?.toDouble(),
  cost: (json['cost'] as num?)?.toDouble(),
  fees: (json['fees'] as num?)?.toDouble(),
);

const _$OrderSideEnumMap = {OrderSide.buy: 'buy', OrderSide.sell: 'sell'};

SimMetrics _$SimMetricsFromJson(Map<String, dynamic> json) => SimMetrics(
  returnPct: (json['returnPct'] as num).toDouble(),
  benchmarkReturnPct: (json['benchmarkReturnPct'] as num).toDouble(),
  maxDrawdownPct: (json['maxDrawdownPct'] as num).toDouble(),
  sharpe: (json['sharpe'] as num?)?.toDouble(),
  trades: (json['trades'] as num).toInt(),
  winRatePct: (json['winRatePct'] as num?)?.toDouble(),
  avgR: (json['avgR'] as num?)?.toDouble(),
  exposurePct: (json['exposurePct'] as num).toDouble(),
  ordersSubmitted: (json['ordersSubmitted'] as num).toInt(),
  ordersRejected: (json['ordersRejected'] as num).toInt(),
  brier: (json['brier'] as num?)?.toDouble(),
  sortino: (json['sortino'] as num?)?.toDouble(),
  calmar: (json['calmar'] as num?)?.toDouble(),
  volatilityPct: (json['volatilityPct'] as num?)?.toDouble(),
  beta: (json['beta'] as num?)?.toDouble(),
  alphaPct: (json['alphaPct'] as num?)?.toDouble(),
  roundTrips: (json['roundTrips'] as num?)?.toInt() ?? 0,
  profitFactor: (json['profitFactor'] as num?)?.toDouble(),
  expectancy: (json['expectancy'] as num?)?.toDouble(),
  avgHoldingDays: (json['avgHoldingDays'] as num?)?.toDouble(),
  maxConsecutiveLosses: (json['maxConsecutiveLosses'] as num?)?.toInt(),
  turnoverPct: (json['turnoverPct'] as num?)?.toDouble() ?? 0,
  costsPaid: (json['costsPaid'] as num?)?.toDouble() ?? 0,
  costsPct: (json['costsPct'] as num?)?.toDouble() ?? 0,
  riskBlocks:
      (json['riskBlocks'] as Map<String, dynamic>?)?.map(
        (k, e) => MapEntry(k, (e as num).toInt()),
      ) ??
      {},
  feesPaid: (json['feesPaid'] as num?)?.toDouble(),
);

SimProgress _$SimProgressFromJson(Map<String, dynamic> json) => SimProgress(
  day: (json['day'] as num).toInt(),
  days: (json['days'] as num).toInt(),
  cycle: (json['cycle'] as num).toInt(),
  cyclesPerDay: (json['cyclesPerDay'] as num).toInt(),
);

SimCalendar _$SimCalendarFromJson(Map<String, dynamic> json) => SimCalendar(
  firstDay: json['firstDay'] as String,
  sourceStart: json['sourceStart'] as String?,
  sourceEnd: json['sourceEnd'] as String?,
);

SimRun _$SimRunFromJson(Map<String, dynamic> json) => SimRun(
  id: json['id'] as String,
  createdAt: (json['createdAt'] as num).toInt(),
  startedBy: $enumDecode(
    _$StartedByEnumMap,
    json['startedBy'],
    unknownValue: StartedBy.user,
  ),
  config: SimRunConfig.fromJson(json['config'] as Map<String, dynamic>),
  seed: (json['seed'] as num?)?.toInt(),
  aliases: (json['aliases'] as Map<String, dynamic>?)?.map(
    (k, e) => MapEntry(k, e as String),
  ),
  calendar: json['calendar'] == null
      ? null
      : SimCalendar.fromJson(json['calendar'] as Map<String, dynamic>),
  suiteId: json['suiteId'] as String?,
  variant: json['variant'] as String?,
  status: $enumDecode(
    _$SimRunStatusEnumMap,
    json['status'],
    unknownValue: SimRunStatus.failed,
  ),
  currentDate: json['currentDate'] as String?,
  progress: SimProgress.fromJson(json['progress'] as Map<String, dynamic>),
  equity: (json['equity'] as List<dynamic>)
      .map((e) => SimEquityPoint.fromJson(e as Map<String, dynamic>))
      .toList(),
  positions: (json['positions'] as List<dynamic>)
      .map((e) => Position.fromJson(e as Map<String, dynamic>))
      .toList(),
  fills: (json['fills'] as List<dynamic>)
      .map((e) => SimFill.fromJson(e as Map<String, dynamic>))
      .toList(),
  metrics: json['metrics'] == null
      ? null
      : SimMetrics.fromJson(json['metrics'] as Map<String, dynamic>),
  error: json['error'] as String?,
  finishedAt: (json['finishedAt'] as num?)?.toInt(),
);

const _$StartedByEnumMap = {StartedBy.user: 'user', StartedBy.agent: 'agent'};

const _$SimRunStatusEnumMap = {
  SimRunStatus.queued: 'queued',
  SimRunStatus.running: 'running',
  SimRunStatus.done: 'done',
  SimRunStatus.failed: 'failed',
  SimRunStatus.stopped: 'stopped',
};

SimVariant _$SimVariantFromJson(Map<String, dynamic> json) => SimVariant(
  label: json['label'] as String,
  strategy: json['strategy'] as String?,
  risk: json['risk'] == null
      ? null
      : RiskConfigPatch.fromJson(json['risk'] as Map<String, dynamic>),
  model: $enumDecodeNullable(
    _$SimModelEnumMap,
    json['model'],
    unknownValue: SimModel.main,
  ),
);

Map<String, dynamic> _$SimVariantToJson(SimVariant instance) =>
    <String, dynamic>{
      'label': instance.label,
      'strategy': instance.strategy,
      'risk': instance.risk?.toJson(),
      'model': _$SimModelEnumMap[instance.model],
    };

SimSuiteConfig _$SimSuiteConfigFromJson(Map<String, dynamic> json) =>
    SimSuiteConfig(
      name: json['name'] as String,
      scenarios:
          (json['scenarios'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const [],
      bootstrapRuns: (json['bootstrapRuns'] as num?)?.toInt() ?? 0,
      scenarioMode:
          $enumDecodeNullable(
            _$ScenarioModeEnumMap,
            json['scenarioMode'],
            unknownValue: ScenarioMode.blind,
          ) ??
          ScenarioMode.blind,
      bootstrapDays: (json['bootstrapDays'] as num?)?.toInt() ?? 40,
      startingCash: (json['startingCash'] as num).toDouble(),
      cyclesPerDay: (json['cyclesPerDay'] as num?)?.toInt() ?? 2,
      execution:
          $enumDecodeNullable(
            _$SimExecutionEnumMap,
            json['execution'],
            unknownValue: SimExecution.realistic,
          ) ??
          SimExecution.realistic,
      watchlist: (json['watchlist'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      variants: (json['variants'] as List<dynamic>)
          .map((e) => SimVariant.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$SimSuiteConfigToJson(SimSuiteConfig instance) =>
    <String, dynamic>{
      'name': instance.name,
      'scenarios': instance.scenarios,
      'bootstrapRuns': instance.bootstrapRuns,
      'scenarioMode': _$ScenarioModeEnumMap[instance.scenarioMode]!,
      'bootstrapDays': instance.bootstrapDays,
      'startingCash': instance.startingCash,
      'cyclesPerDay': instance.cyclesPerDay,
      'execution': _$SimExecutionEnumMap[instance.execution]!,
      'watchlist': instance.watchlist,
      'variants': instance.variants.map((e) => e.toJson()).toList(),
    };

const _$ScenarioModeEnumMap = {
  ScenarioMode.historical: 'historical',
  ScenarioMode.blind: 'blind',
};

SimSuiteVariantSummary _$SimSuiteVariantSummaryFromJson(
  Map<String, dynamic> json,
) => SimSuiteVariantSummary(
  label: json['label'] as String,
  runs: (json['runs'] as num).toInt(),
  done: (json['done'] as num).toInt(),
  failed: (json['failed'] as num).toInt(),
  meanReturnPct: (json['meanReturnPct'] as num?)?.toDouble(),
  medianReturnPct: (json['medianReturnPct'] as num?)?.toDouble(),
  p10ReturnPct: (json['p10ReturnPct'] as num?)?.toDouble(),
  p90ReturnPct: (json['p90ReturnPct'] as num?)?.toDouble(),
  meanExcessPct: (json['meanExcessPct'] as num?)?.toDouble(),
  beatBenchmarkPct: (json['beatBenchmarkPct'] as num?)?.toDouble(),
  worstDrawdownPct: (json['worstDrawdownPct'] as num?)?.toDouble(),
  medianSharpe: (json['medianSharpe'] as num?)?.toDouble(),
  winRatePct: (json['winRatePct'] as num?)?.toDouble(),
  avgR: (json['avgR'] as num?)?.toDouble(),
  costsPct: (json['costsPct'] as num?)?.toDouble(),
  brier: (json['brier'] as num?)?.toDouble(),
);

SimSuiteRunEntry _$SimSuiteRunEntryFromJson(Map<String, dynamic> json) =>
    SimSuiteRunEntry(
      runId: json['runId'] as String,
      variant: json['variant'] as String,
      scenario: json['scenario'] as String?,
      seed: (json['seed'] as num?)?.toInt(),
      mode: $enumDecode(
        _$SimModeEnumMap,
        json['mode'],
        unknownValue: SimMode.historical,
      ),
    );

SimComparison _$SimComparisonFromJson(Map<String, dynamic> json) =>
    SimComparison(
      metric: json['metric'] as String,
      meanDiff: (json['meanDiff'] as num).toDouble(),
      ci95: (json['ci95'] as List<dynamic>)
          .map((e) => (e as num).toDouble())
          .toList(),
      pairs: (json['pairs'] as num).toInt(),
    );

SimSuite _$SimSuiteFromJson(Map<String, dynamic> json) => SimSuite(
  id: json['id'] as String,
  createdAt: (json['createdAt'] as num).toInt(),
  startedBy: $enumDecode(
    _$StartedByEnumMap,
    json['startedBy'],
    unknownValue: StartedBy.user,
  ),
  config: SimSuiteConfig.fromJson(json['config'] as Map<String, dynamic>),
  status: $enumDecode(
    _$SimRunStatusEnumMap,
    json['status'],
    unknownValue: SimRunStatus.failed,
  ),
  runs: (json['runs'] as List<dynamic>)
      .map((e) => SimSuiteRunEntry.fromJson(e as Map<String, dynamic>))
      .toList(),
  summary: (json['summary'] as List<dynamic>)
      .map((e) => SimSuiteVariantSummary.fromJson(e as Map<String, dynamic>))
      .toList(),
  comparison: json['comparison'] == null
      ? null
      : SimComparison.fromJson(json['comparison'] as Map<String, dynamic>),
  finishedAt: (json['finishedAt'] as num?)?.toInt(),
);
