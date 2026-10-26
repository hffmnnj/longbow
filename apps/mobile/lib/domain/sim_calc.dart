import 'dart:math' as math;

import 'package:intl/intl.dart';
import 'package:longbow/models/models.dart';

/// Dart port of `apps/web/src/lib/sim.ts`, minus the pieces that need the
/// live feed reducer (`SimState`, `emptySim`, `applySimEvent` — those symbols
/// live with the reducer port in `lib/data/`).
///
/// `riskOverrides` validates against the same limits as
/// `RiskConfigSchema` in `packages/shared/src/index.ts`; see [_riskLimits].
/// The messages mirror `fieldError` in the web's `settingsForm.ts`.

/// Minutes of wall time the server spends per simulated cycle.
const double minutesPerCycle = 1.5;

double estimateMinutes(int days, int cyclesPerDay) =>
    days * cyclesPerDay * minutesPerCycle;

/// "about 30 min", "about 1 h 30 min", "about 1 min".
String formatEstimate(double minutes) {
  final m = math.max(1, minutes.round());
  if (m < 60) return 'about $m min';
  final h = m ~/ 60;
  final rest = m % 60;
  return rest == 0 ? 'about $h h' : 'about $h h $rest min';
}

const int _dayMs = 86400000;

String _ymd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

bool _isWeekday(DateTime d) => d.weekday != 6 && d.weekday != 7;

/// The date `n` weekdays ago from [from] (UTC calendar math; exchange holidays
/// are the server's job).
String weekdaysAgo(int n, [DateTime? from]) {
  final f = (from ?? DateTime.now()).toUtc();
  var d = DateTime.utc(f.year, f.month, f.day);
  var left = n;
  while (left > 0) {
    d = d.subtract(const Duration(milliseconds: _dayMs));
    if (_isWeekday(d)) left--;
  }
  return _ymd(d);
}

/// Weekdays from [start] (inclusive) up to today (exclusive).
int weekdaysBetween(String start, [DateTime? end]) {
  final s = DateTime.tryParse('${start}T00:00:00Z');
  if (s == null) return 0;
  final e = end ?? DateTime.now();
  final eu = e.toUtc();
  final limit = DateTime.utc(eu.year, eu.month, eu.day);
  var count = 0;
  for (var d = s; d.isBefore(limit);
      d = d.add(const Duration(milliseconds: _dayMs))) {
    if (_isWeekday(d)) count++;
  }
  return count;
}

/// Null when the window fits in the past, else a short reason. Bootstrap runs
/// need no date.
String? startDateProblem(String? start, int days, [DateTime? now]) {
  if (start == null || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(start)) {
    return 'Pick a start date';
  }
  final available = weekdaysBetween(start, now ?? DateTime.now());
  return available < days
      ? 'Only $available trading days between $start and today'
      : null;
}

List<SimRun> upsertSimRun(List<SimRun> runs, SimRun run) {
  final out = runs.where((r) => r.id != run.id).toList()..add(run);
  out.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return out;
}

List<SimSuite> upsertSuite(List<SimSuite> suites, SimSuite suite) {
  final out = suites.where((s) => s.id != suite.id).toList()..add(suite);
  out.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return out;
}

bool isActive(SimRunStatus s) =>
    s == SimRunStatus.queued || s == SimRunStatus.running;

/// Configured name, else the strategy's first words, else a dated fallback.
String runTitle(SimRun run) {
  final name = run.config.name?.trim();
  if (name != null && name.isNotEmpty) return name;
  final words =
      run.config.strategy?.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList() ?? [];
  if (words.isNotEmpty) {
    return words.length > 6
        ? '${words.sublist(0, 6).join(' ')}\u2026'
        : words.join(' ');
  }
  final days = run.config.days;
  if (run.config.mode == SimMode.bootstrap) return '$days-day bootstrap';
  if (run.config.scenario != null) return '$days-day ${run.config.scenario}';
  return run.config.startDate != null
      ? '$days-day run from ${run.config.startDate}'
      : '$days-day run';
}

/// Header tag for blind and bootstrap runs, whose dates and tickers are
/// fictional.
String? envBadge(SimRun run) {
  if (run.config.mode == SimMode.blind) return 'Blind \u00b7 fictional dates';
  if (run.config.mode == SimMode.bootstrap) {
    return 'Bootstrap \u00b7 seed ${run.seed ?? run.config.seed ?? '?'}';
  }
  return null;
}

/// Display symbol: with the reveal toggle on, a finished blind or bootstrap
/// run shows the real ticker.
String shownSymbol(SimRun run, String symbol, bool revealed) {
  if (revealed && run.aliases != null) return run.aliases![symbol] ?? symbol;
  return symbol;
}

/// True when the run has ended and its alias map is available to reveal.
bool canReveal(SimRun run) =>
    (run.status == SimRunStatus.done || run.status == SimRunStatus.stopped) &&
    run.aliases != null &&
    run.aliases!.isNotEmpty;

class RunNumbers {
  const RunNumbers({
    required this.returnPct,
    required this.benchmarkReturnPct,
    required this.maxDrawdownPct,
  });
  final double returnPct;
  final double benchmarkReturnPct;
  final double maxDrawdownPct;

  @override
  bool operator ==(Object other) =>
      other is RunNumbers &&
      other.returnPct == returnPct &&
      other.benchmarkReturnPct == benchmarkReturnPct &&
      other.maxDrawdownPct == maxDrawdownPct;

  @override
  int get hashCode =>
      Object.hash(returnPct, benchmarkReturnPct, maxDrawdownPct);
}

/// Server metrics when present, else the same three figures computed from the
/// marks so far.
RunNumbers? runNumbers(SimRun run) {
  if (run.metrics != null) {
    final m = run.metrics!;
    return RunNumbers(
      returnPct: m.returnPct,
      benchmarkReturnPct: m.benchmarkReturnPct,
      maxDrawdownPct: m.maxDrawdownPct,
    );
  }
  if (run.equity.isEmpty) return null;
  final last = run.equity.last;
  final base = run.config.startingCash;
  var peak = base;
  var dd = 0.0;
  for (final p in run.equity) {
    peak = math.max(peak, p.equity);
    if (peak > 0) dd = math.max(dd, ((peak - p.equity) / peak) * 100);
  }
  return RunNumbers(
    returnPct: (last.equity / base - 1) * 100,
    benchmarkReturnPct: (last.benchmark / base - 1) * 100,
    maxDrawdownPct: dd,
  );
}

/// Full cost of a fill: spread/slippage plus regulatory fees. Null when the
/// fill records neither.
double? fillCost(SimFill f) {
  if (f.cost == null && f.fees == null) return null;
  return (f.cost ?? 0) + (f.fees ?? 0);
}

/// Alpha is plain return minus benchmark return, in percentage points.
double alpha(SimMetrics m) => m.returnPct - m.benchmarkReturnPct;

class DayPoint {
  const DayPoint({required this.day, required this.value});
  final int day;
  final double value;

  @override
  bool operator ==(Object other) =>
      other is DayPoint && other.day == day && other.value == value;

  @override
  int get hashCode => Object.hash(day, value);
}

/// Equity indexed to 100 at the starting cash. Day 0 is the start; day N is
/// the Nth close.
List<DayPoint> normalizedSeries(SimRun run) {
  final base = run.config.startingCash;
  if (!(base > 0)) return [];
  return [
    const DayPoint(day: 0, value: 100),
    for (var i = 0; i < run.equity.length; i++)
      DayPoint(day: i + 1, value: (run.equity[i].equity / base) * 100),
  ];
}

/// Label for a run in the compare view, made unique when titles collide.
List<String> compareLabels(List<SimRun> runs) {
  final seen = <String, int>{};
  return runs.map((r) {
    final t = runTitle(r);
    final n = (seen[t] ?? 0) + 1;
    seen[t] = n;
    return n == 1 ? t : '$t ($n)';
  }).toList();
}

double progressFraction(SimRun run) => run.status == SimRunStatus.done
    ? 1
    : run.progress.days > 0
        ? math.min(1, run.progress.day / run.progress.days)
        : 0;

const Map<SimRunStatus, String> statusLabel = {
  SimRunStatus.queued: 'Queued',
  SimRunStatus.running: 'Running',
  SimRunStatus.done: 'Done',
  SimRunStatus.failed: 'Failed',
  SimRunStatus.stopped: 'Stopped',
};

SimRunConfig defaultSimConfig({
  List<String> watchlist = const [],
  DateTime? now,
}) =>
    SimRunConfig(
      mode: SimMode.blind,
      execution: SimExecution.realistic,
      model: SimModel.main,
      startDate: weekdaysAgo(15, now ?? DateTime.now()),
      days: 10,
      startingCash: 1200,
      cyclesPerDay: 2,
      watchlist: watchlist.isNotEmpty ? List.of(watchlist) : null,
    );

/// Every key of the shared `RiskConfig`, for per-field sim overrides.
enum RiskKey {
  maxRiskPerTradePct,
  maxPositionPct,
  maxSectorPct,
  maxPositions,
  maxOrderNotionalUsd,
  minOrderNotionalUsd,
  dailyLossHaltPct,
  monthlyDrawdownHaltPct,
  maxEntriesPerDay,
  minHoldDays,
  maxSpreadBps,
  maxSlippageBps,
  noTradeOpenMinutes,
  noTradeCloseMinutes,
  maxDayTrades5d,
  minEvToCost,
  earningsBlackoutDays,
  minAvgDollarVolumeUsd,
}

class _RiskLimit {
  const _RiskLimit({this.min, this.minExclusive = false, this.max, this.isInt = false});
  final double? min;
  final bool minExclusive;
  final double? max;
  final bool isInt;
}

/// Same limits as `RiskConfigSchema` in `packages/shared/src/index.ts`:
/// positive() is an exclusive minimum of 0, nonnegative() an inclusive one.
const Map<RiskKey, _RiskLimit> _riskLimits = {
  RiskKey.maxRiskPerTradePct: _RiskLimit(min: 0, minExclusive: true, max: 5),
  RiskKey.maxPositionPct: _RiskLimit(min: 0, minExclusive: true, max: 100),
  RiskKey.maxSectorPct: _RiskLimit(min: 0, minExclusive: true, max: 100),
  RiskKey.maxPositions: _RiskLimit(min: 0, minExclusive: true, max: 50, isInt: true),
  RiskKey.maxOrderNotionalUsd: _RiskLimit(min: 0, minExclusive: true),
  RiskKey.minOrderNotionalUsd: _RiskLimit(min: 0),
  RiskKey.dailyLossHaltPct: _RiskLimit(min: 0, minExclusive: true, max: 50),
  RiskKey.monthlyDrawdownHaltPct: _RiskLimit(min: 0, minExclusive: true, max: 80),
  RiskKey.maxEntriesPerDay: _RiskLimit(min: 0, max: 50, isInt: true),
  RiskKey.minHoldDays: _RiskLimit(min: 0, max: 30, isInt: true),
  RiskKey.maxSpreadBps: _RiskLimit(min: 0, minExclusive: true, max: 1000),
  RiskKey.maxSlippageBps: _RiskLimit(min: 0, max: 500),
  RiskKey.noTradeOpenMinutes: _RiskLimit(min: 0, max: 120, isInt: true),
  RiskKey.noTradeCloseMinutes: _RiskLimit(min: 0, max: 120, isInt: true),
  RiskKey.maxDayTrades5d: _RiskLimit(min: 0, max: 10, isInt: true),
  RiskKey.minEvToCost: _RiskLimit(min: 0, max: 20),
  RiskKey.earningsBlackoutDays: _RiskLimit(min: 0, max: 20, isInt: true),
  RiskKey.minAvgDollarVolumeUsd: _RiskLimit(min: 0),
};

String _fmtLimit(double v) => v == v.roundToDouble() ? '${v.round()}' : '$v';

/// Minimal port of `fieldError` from the web's `settingsForm.ts`: turns a
/// text input into a short inline error, or null when valid.
String? _fieldError(_RiskLimit lim, String raw) {
  final n = double.tryParse(raw);
  if (n == null || !n.isFinite) return 'Enter a number';
  if (lim.min != null && (lim.minExclusive ? n <= lim.min! : n < lim.min!)) {
    return lim.minExclusive ? 'Must be above ${_fmtLimit(lim.min!)}' : 'Min ${_fmtLimit(lim.min!)}';
  }
  if (lim.max != null && n > lim.max!) return 'Max ${_fmtLimit(lim.max!)}';
  if (lim.isInt && n != n.roundToDouble()) return 'Whole number';
  return null;
}

class RiskOverridesResult {
  const RiskOverridesResult({this.risk, required this.errors});
  final RiskConfigPatch? risk;
  final Map<String, String> errors;
}

/// Blank fields mean "use the live setting"; filled ones become overrides,
/// with inline errors.
RiskOverridesResult riskOverrides(Map<RiskKey, String> raw) {
  final values = <String, double>{};
  final errors = <String, String>{};
  for (final entry in raw.entries) {
    if (entry.value.trim().isEmpty) continue;
    final err = _fieldError(_riskLimits[entry.key]!, entry.value);
    if (err != null) {
      errors['risk.${entry.key.name}'] = err;
    } else {
      values[entry.key.name] = double.parse(entry.value);
    }
  }
  int? asInt(String key) => values[key]?.round();
  return RiskOverridesResult(
    risk: values.isEmpty
        ? null
        : RiskConfigPatch(
            maxRiskPerTradePct: values['maxRiskPerTradePct'],
            maxPositionPct: values['maxPositionPct'],
            maxSectorPct: values['maxSectorPct'],
            maxPositions: asInt('maxPositions'),
            maxOrderNotionalUsd: values['maxOrderNotionalUsd'],
            minOrderNotionalUsd: values['minOrderNotionalUsd'],
            dailyLossHaltPct: values['dailyLossHaltPct'],
            monthlyDrawdownHaltPct: values['monthlyDrawdownHaltPct'],
            maxEntriesPerDay: asInt('maxEntriesPerDay'),
            minHoldDays: asInt('minHoldDays'),
            maxSpreadBps: values['maxSpreadBps'],
            maxSlippageBps: values['maxSlippageBps'],
            noTradeOpenMinutes: asInt('noTradeOpenMinutes'),
            noTradeCloseMinutes: asInt('noTradeCloseMinutes'),
            maxDayTrades5d: asInt('maxDayTrades5d'),
            minEvToCost: values['minEvToCost'],
            earningsBlackoutDays: asInt('earningsBlackoutDays'),
            minAvgDollarVolumeUsd: values['minAvgDollarVolumeUsd'],
          ),
    errors: errors,
  );
}

class MetricBar {
  const MetricBar({required this.label, required this.value});
  final String label;
  final int value;

  @override
  bool operator ==(Object other) =>
      other is MetricBar && other.label == label && other.value == value;

  @override
  int get hashCode => Object.hash(label, value);
}

class MetricRow {
  const MetricRow({required this.label, this.pnl, this.text, this.sub, this.bars});
  final String label;

  /// Signed percent shown with gain/loss color.
  final double? pnl;
  final String? text;

  /// Smaller second line, for example the percent next to the dollars.
  final String? sub;

  /// Risk blocks render as small bars instead of a single figure.
  final List<MetricBar>? bars;

  @override
  bool operator ==(Object other) =>
      other is MetricRow &&
      other.label == label &&
      other.pnl == pnl &&
      other.text == text &&
      other.sub == sub &&
      _barsEqual(other.bars, bars);

  @override
  int get hashCode => Object.hash(label, pnl, text, sub, bars);

  static bool _barsEqual(List<MetricBar>? a, List<MetricBar>? b) {
    if (a == null || b == null) return a == b;
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

class MetricGroup {
  const MetricGroup({required this.title, required this.rows});
  final String title;
  final List<MetricRow> rows;
}

final NumberFormat _intFmt = NumberFormat('#,##0', 'en_US');

/// Dollars without cents for compact metric cells: $1,240, −$35.
String _usdShort(double value) {
  final sign = value < 0 && value.abs() >= 0.5 ? '\u2212' : '';
  return '$sign\$${_intFmt.format(value.abs().round())}';
}

/// The run detail groups: undefined metrics are omitted, never dashed.
List<MetricGroup> metricGroups(SimRun run) {
  final m = run.metrics;
  final n = runNumbers(run);
  String? fmt(double? v, String Function(double) f) =>
      v == null ? null : f(v);
  String? f2(double? v) => fmt(v, (x) => x.toStringAsFixed(2));
  String? pct1(double? v) => fmt(v, (x) => '${x.toStringAsFixed(1)}%');

  final ret = <MetricGroup>[];

  final risk = <MetricRow>[];
  if (n != null) {
    risk.add(MetricRow(label: 'Return', pnl: n.returnPct));
    risk.add(
      MetricRow(
        label: 'Vs benchmark',
        pnl: n.returnPct - n.benchmarkReturnPct,
        sub: 'SPY ${n.benchmarkReturnPct.toStringAsFixed(1)}%',
      ),
    );
  }
  if (m?.alphaPct != null) risk.add(MetricRow(label: 'Alpha', pnl: m!.alphaPct));
  if (m?.beta != null) {
    risk.add(MetricRow(label: 'Beta', text: m!.beta!.toStringAsFixed(2)));
  }
  final sharpe = f2(m?.sharpe);
  if (sharpe != null) risk.add(MetricRow(label: 'Sharpe', text: sharpe));
  final sortino = f2(m?.sortino);
  if (sortino != null) risk.add(MetricRow(label: 'Sortino', text: sortino));
  final calmar = f2(m?.calmar);
  if (calmar != null) risk.add(MetricRow(label: 'Calmar', text: calmar));
  if (n != null) {
    risk.add(
      MetricRow(
        label: 'Max drawdown',
        text: '${n.maxDrawdownPct.toStringAsFixed(2)}%',
      ),
    );
  }
  final vol = pct1(m?.volatilityPct);
  if (vol != null) risk.add(MetricRow(label: 'Volatility', text: vol));
  if (risk.isNotEmpty) ret.add(MetricGroup(title: 'Return and risk', rows: risk));

  final trading = <MetricRow>[];
  if (m != null) {
    trading.add(MetricRow(label: 'Round trips', text: '${m.roundTrips}'));
    final wr = fmt(m.winRatePct, (x) => '${x.toStringAsFixed(0)}%');
    if (wr != null) trading.add(MetricRow(label: 'Win rate', text: wr));
    final avgR = fmt(m.avgR, (x) => '${x.toStringAsFixed(2)}R');
    if (avgR != null) trading.add(MetricRow(label: 'Avg R', text: avgR));
    final pf = f2(m.profitFactor);
    if (pf != null) trading.add(MetricRow(label: 'Profit factor', text: pf));
    if (m.expectancy != null) {
      trading.add(
        MetricRow(label: 'Expectancy', text: _usdShort(m.expectancy!)),
      );
    }
    final hold = fmt(m.avgHoldingDays, (x) => '${x.toStringAsFixed(1)}d');
    if (hold != null) trading.add(MetricRow(label: 'Avg holding', text: hold));
    trading.add(
      MetricRow(label: 'Turnover', text: '${m.turnoverPct.toStringAsFixed(0)}%'),
    );
  } else if (n != null || run.fills.isNotEmpty) {
    trading.add(MetricRow(label: 'Fills', text: '${run.fills.length}'));
  }
  if (trading.isNotEmpty) ret.add(MetricGroup(title: 'Trading', rows: trading));

  final costs = <MetricRow>[];
  if (m != null &&
      !(m.costsPaid == 0 && m.costsPct == 0 && run.fills.isEmpty)) {
    // Costs on a small account are cents, so they keep two decimals where other money figures round.
    costs.add(
      MetricRow(
        label: 'Costs paid',
        text: '\$${m.costsPaid.toStringAsFixed(2)}',
        sub: '${m.costsPct.toStringAsFixed(2)}% of start',
      ),
    );
    // Regulatory fees alone, already included in the costs above.
    if (m.feesPaid != null && m.feesPaid! > 0) {
      costs.add(
        MetricRow(label: 'Fees', text: '\$${m.feesPaid!.toStringAsFixed(2)}'),
      );
    }
  }
  if (costs.isNotEmpty) ret.add(MetricGroup(title: 'Costs', rows: costs));

  final discipline = <MetricRow>[];
  final blocks = m == null
      ? <MapEntry<String, int>>[]
      : (m.riskBlocks.entries.toList()
        ..sort((a, b) => b.value.compareTo(a.value)));
  if (blocks.isNotEmpty) {
    discipline.add(
      MetricRow(
        label: 'Risk blocks',
        bars: blocks
            .map((e) => MetricBar(label: e.key, value: e.value))
            .toList(),
      ),
    );
  }
  final brier = fmt(m?.brier, (x) => x.toStringAsFixed(3));
  if (brier != null) {
    discipline.add(
      MetricRow(label: 'Brier', text: brier, sub: 'lower is better'),
    );
  }
  if (discipline.isNotEmpty) {
    ret.add(MetricGroup(title: 'Discipline', rows: discipline));
  }

  return ret;
}

/// Flattened groups for the run-compare table; missing values dash so columns
/// stay aligned. (The web exports this as `DASH`.)
const String simDash = '\u2014';

List<MetricRow> metricRows(SimRun run) =>
    metricGroups(run).expand((g) => g.rows).toList();

/// One-decimal points with a true minus sign: 0.8, −0.3.
String _points(double x) =>
    '${x < 0 ? '\u2212' : ''}${x.abs().toStringAsFixed(1)}';

class ComparisonReading {
  const ComparisonReading({required this.text, required this.conclusive});

  /// True only when the 95% interval excludes zero.
  final bool conclusive;
  final String text;

  @override
  bool operator ==(Object other) =>
      other is ComparisonReading &&
      other.text == text &&
      other.conclusive == conclusive;

  @override
  int get hashCode => Object.hash(text, conclusive);
}

/// Plain reading of a two-variant suite comparison, for example "B beat A by
/// 0.8 points; 95% interval −0.3 to 1.9; not conclusive".
ComparisonReading? comparisonReading(SimSuite suite) {
  final c = suite.comparison;
  if (c == null) return null;
  final a = suite.config.variants.isNotEmpty
      ? suite.config.variants[0].label
      : 'A';
  final b = suite.config.variants.length > 1
      ? suite.config.variants[1].label
      : 'B';
  final head = c.meanDiff > 0
      ? '$b beat $a by ${_points(c.meanDiff)} points'
      : c.meanDiff < 0
          ? '$a beat $b by ${_points(-c.meanDiff)} points'
          : '$a tied $b';
  final conclusive = c.ci95[0] > 0 || c.ci95[1] < 0;
  return ComparisonReading(
    text:
        '$head; 95% interval ${_points(c.ci95[0])} to ${_points(c.ci95[1])}; ${conclusive ? 'conclusive' : 'not conclusive'}',
    conclusive: conclusive,
  );
}

class SuiteProgress {
  const SuiteProgress({required this.done, required this.total});
  final int done;
  final int total;

  @override
  bool operator ==(Object other) =>
      other is SuiteProgress && other.done == done && other.total == total;

  @override
  int get hashCode => Object.hash(done, total);
}

/// Finished runs out of the suite's total, resolved against the lab's run
/// list.
SuiteProgress suiteProgress(SimSuite suite, List<SimRun> runs) {
  final byId = {for (final r in runs) r.id: r};
  var done = 0;
  for (final entry in suite.runs) {
    final s = byId[entry.runId]?.status;
    if (s == SimRunStatus.done ||
        s == SimRunStatus.failed ||
        s == SimRunStatus.stopped) {
      done++;
    }
  }
  return SuiteProgress(done: done, total: suite.runs.length);
}

/// Excess return of one run over its benchmark, in points, when the run has
/// metrics.
double? excessReturn(SimRun run) => run.metrics != null
    ? run.metrics!.returnPct - run.metrics!.benchmarkReturnPct
    : null;
