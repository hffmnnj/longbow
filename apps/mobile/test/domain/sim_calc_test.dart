import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/domain/sim_calc.dart';
import 'package:longbow/models/models.dart';

SimRunConfig _cfg({
  String? name,
  String? strategy,
  SimMode mode = SimMode.historical,
  String? scenario,
  String? startDate = '2026-10-01',
  int days = 5,
  double startingCash = 1000,
  int cyclesPerDay = 2,
  int? seed,
}) =>
    SimRunConfig(
      name: name,
      strategy: strategy,
      mode: mode,
      scenario: scenario,
      startDate: startDate,
      days: days,
      startingCash: startingCash,
      cyclesPerDay: cyclesPerDay,
      seed: seed,
    );

SimRun _run(
  String id, {
  SimRunConfig? config,
  int createdAt = 1,
  SimRunStatus status = SimRunStatus.running,
  List<SimEquityPoint> equity = const [],
  List<SimFill> fills = const [],
  SimMetrics? metrics,
  Map<String, String>? aliases,
  int? seed,
}) =>
    SimRun(
      id: id,
      createdAt: createdAt,
      startedBy: StartedBy.user,
      config: config ?? _cfg(),
      status: status,
      progress: const SimProgress(day: 0, days: 5, cycle: 1, cyclesPerDay: 2),
      equity: equity,
      positions: const [],
      fills: fills,
      metrics: metrics,
      aliases: aliases,
      seed: seed,
    );

const _baseMetrics = SimMetrics(
  returnPct: 1.5,
  benchmarkReturnPct: 0.5,
  maxDrawdownPct: 2,
  trades: 0,
  exposurePct: 0,
  ordersSubmitted: 0,
  ordersRejected: 0,
  roundTrips: 0,
  turnoverPct: 0,
  costsPaid: 0,
  costsPct: 0,
  riskBlocks: {},
);

SimEquityPoint _point(String date, double equity, [double benchmark = 1000]) =>
    SimEquityPoint(date: date, equity: equity, cash: 0, benchmark: benchmark);

SimMetrics _metrics({
  double returnPct = 1.5,
  double benchmarkReturnPct = 0.5,
  double maxDrawdownPct = 2,
  double? sharpe,
  double? winRatePct,
  double? avgR,
  double? profitFactor,
  double? expectancy,
  double? avgHoldingDays,
  double turnoverPct = 0,
  double costsPaid = 0,
  double costsPct = 0,
  double? feesPaid,
  double? brier,
  Map<String, int> riskBlocks = const {},
}) =>
    SimMetrics(
      returnPct: returnPct,
      benchmarkReturnPct: benchmarkReturnPct,
      maxDrawdownPct: maxDrawdownPct,
      trades: 0,
      exposurePct: 0,
      ordersSubmitted: 0,
      ordersRejected: 0,
      roundTrips: 0,
      turnoverPct: turnoverPct,
      costsPaid: costsPaid,
      costsPct: costsPct,
      riskBlocks: riskBlocks,
      sharpe: sharpe,
      winRatePct: winRatePct,
      avgR: avgR,
      profitFactor: profitFactor,
      expectancy: expectancy,
      avgHoldingDays: avgHoldingDays,
      feesPaid: feesPaid,
      brier: brier,
    );

SimSuite _suite(
  String id, {
  int createdAt = 1,
  SimRunStatus status = SimRunStatus.running,
  List<SimSuiteRunEntry> runs = const [],
  SimComparison? comparison,
  List<SimVariant> variants = const [SimVariant(label: 'A')],
}) =>
    SimSuite(
      id: id,
      createdAt: createdAt,
      startedBy: StartedBy.user,
      config: SimSuiteConfig(
        name: id,
        scenarios: const [],
        bootstrapRuns: 0,
        scenarioMode: ScenarioMode.blind,
        bootstrapDays: 40,
        startingCash: 1200,
        cyclesPerDay: 2,
        execution: SimExecution.realistic,
        variants: variants,
      ),
      status: status,
      runs: runs,
      summary: const [],
      comparison: comparison,
    );

void main() {
  group('upsert helpers', () {
    test('upserts runs by id and keeps the newest first', () {
      var runs = upsertSimRun([], _run('a', createdAt: 10));
      runs = upsertSimRun(runs, _run('b', createdAt: 20));
      runs = upsertSimRun(
          runs, _run('a', createdAt: 10, status: SimRunStatus.done));
      expect(
        runs.map((r) => [r.id, r.status]).toList(),
        [
          ['b', SimRunStatus.running],
          ['a', SimRunStatus.done],
        ],
      );
    });

    test('upserts suites with the same helper the store uses', () {
      expect(
        upsertSuite([_suite('s1')],
            _suite('s1', status: SimRunStatus.stopped))[0].status,
        SimRunStatus.stopped,
      );
    });

    test('upserts suites newest first on suite events', () {
      var suites = upsertSuite([], _suite('s1'));
      suites = upsertSuite(suites, _suite('s2', createdAt: 2));
      expect(suites.map((x) => x.id), ['s2', 's1']);
      suites = upsertSuite(
          suites, _suite('s1', status: SimRunStatus.done));
      expect(suites.firstWhere((x) => x.id == 's1').status,
          SimRunStatus.done);
    });

    test('counts finished member runs against the lab list', () {
      final suite = _suite('s1', runs: const [
        SimSuiteRunEntry(runId: 'r1', variant: 'A', mode: SimMode.blind),
        SimSuiteRunEntry(runId: 'r2', variant: 'A', mode: SimMode.blind),
      ]);
      final runs = [
        _run('r1', status: SimRunStatus.done),
        _run('r2', status: SimRunStatus.running),
      ];
      expect(suiteProgress(suite, runs), const SuiteProgress(done: 1, total: 2));
    });
  });

  group('duration estimate', () {
    test('is cycles times one and a half minutes', () {
      expect(estimateMinutes(10, 2), 30);
      expect(estimateMinutes(60, 4), 360);
      expect(estimateMinutes(1, 2), 3);
    });

    test('words minutes and hours', () {
      expect(formatEstimate(30), 'about 30 min');
      expect(formatEstimate(90), 'about 1 h 30 min');
      expect(formatEstimate(360), 'about 6 h');
      expect(formatEstimate(0.2), 'about 1 min');
    });
  });

  group('normalizedSeries', () {
    test('indexes equity to the starting cash with day 0 at 100', () {
      final r = _run('a',
          config: _cfg(days: 3, startingCash: 1200, cyclesPerDay: 2),
          equity: [_point('2026-10-01', 1260), _point('2026-10-02', 1140)]);
      expect(normalizedSeries(r), [
        const DayPoint(day: 0, value: 100),
        const DayPoint(day: 1, value: 105),
        const DayPoint(day: 2, value: 95),
      ]);
    });

    test('lets runs with different start cash share one axis', () {
      final small = normalizedSeries(_run('s', equity: [_point('d', 1100)]));
      final big = normalizedSeries(_run('b',
          config: _cfg(startDate: 'x', days: 1, startingCash: 5000, cyclesPerDay: 2),
          equity: [_point('d', 5500)]));
      expect(small.last.value, closeTo(110, 1e-9));
      expect(big.last.value, closeTo(110, 1e-9));
    });

    test('is empty for a nonsensical starting cash', () {
      expect(
        normalizedSeries(_run('z',
            config: _cfg(startDate: 'x', days: 1, startingCash: 0, cyclesPerDay: 2))),
        isEmpty,
      );
    });
  });

  group('runNumbers', () {
    test('derives return, benchmark and max drawdown from marks without metrics', () {
      final r = _run('a', equity: [
        _point('1', 1100, 1010),
        _point('2', 990, 1020),
        _point('3', 1050, 1030),
      ]);
      final n = runNumbers(r)!;
      expect(n.returnPct, closeTo(5, 1e-9));
      expect(n.benchmarkReturnPct, closeTo(3, 1e-9));
      expect(n.maxDrawdownPct, closeTo(10, 1e-9)); // 1100 -> 990
    });

    test('prefers the server metrics once the run has them', () {
      final r = _run('a',
          equity: [_point('1', 2000)], metrics: _baseMetrics);
      expect(
        runNumbers(r),
        const RunNumbers(
            returnPct: 1.5, benchmarkReturnPct: 0.5, maxDrawdownPct: 2),
      );
    });

    test('is null before the first close', () {
      expect(runNumbers(_run('a')), isNull);
    });
  });

  group('run titles', () {
    test('uses the name, else the strategy first six words, else the window', () {
      expect(
        runTitle(_run('a',
            config: _cfg(name: ' Gap fade '))),
        'Gap fade',
      );
      expect(
        runTitle(_run('a',
            config: _cfg(
                strategy: 'Buy dips in quality names after gaps down'))),
        'Buy dips in quality names after\u2026',
      );
      expect(runTitle(_run('a')), '5-day run from 2026-10-01');
    });

    test('disambiguates identical titles in the compare view', () {
      expect(
        compareLabels([_run('a'), _run('b'), _run('c')]),
        [
          '5-day run from 2026-10-01',
          '5-day run from 2026-10-01 (2)',
          '5-day run from 2026-10-01 (3)',
        ],
      );
    });
  });

  group('start date', () {
    // 2026-10-24 is a Saturday.
    final sat = DateTime.utc(2026, 10, 24, 12);
    test('counts weekdays back, skipping weekends', () {
      expect(weekdaysAgo(1, sat), '2026-10-23');
      expect(weekdaysAgo(5, sat), '2026-10-19');
      expect(weekdaysAgo(15, sat), '2026-10-05');
    });

    test('flags a window that does not fit before today', () {
      expect(startDateProblem('2026-10-05', 10, sat), isNull);
      expect(startDateProblem('2026-10-19', 10, sat),
          'Only 5 trading days between 2026-10-19 and today');
      expect(startDateProblem('', 10, sat), 'Pick a start date');
    });
  });

  group('riskOverrides', () {
    test('keeps only filled fields and reports invalid ones inline', () {
      final res = riskOverrides({
        RiskKey.maxPositions: '3',
        RiskKey.maxPositionPct: '',
        RiskKey.maxRiskPerTradePct: '-1',
      });
      expect(res.risk?.maxPositions, 3);
      expect(res.errors.keys, ['risk.maxRiskPerTradePct']);
    });

    test('returns no risk object when nothing is overridden', () {
      final res = riskOverrides({RiskKey.maxPositions: ' '});
      expect(res.risk, isNull);
      expect(res.errors, isEmpty);
    });
  });

  group('metricGroups', () {
    test('omits undefined metrics instead of dashing them', () {
      final r = _run('a',
          equity: [_point('1', 1100)], metrics: _baseMetrics);
      final groups = metricGroups(r);
      final risk = groups.firstWhere((g) => g.title == 'Return and risk');
      expect(risk.rows.map((x) => x.label), contains('Return'));
      expect(risk.rows.map((x) => x.label), isNot(contains('Sharpe')));
      expect(risk.rows.map((x) => x.label), isNot(contains('Alpha')));
      expect(groups.any((g) => g.title == 'Discipline'), isFalse);
      expect(groups.any((g) => g.title == 'Costs'), isFalse);
    });

    test('shows each figure once: costs in dollars and percent, blocks as bars', () {
      final r = _run('a',
          equity: [_point('1', 1100)],
          metrics: _metrics(
            returnPct: 5,
            benchmarkReturnPct: 1,
            sharpe: 1.2,
            costsPaid: 12.5,
            costsPct: 1.04,
            riskBlocks: const {'sector': 2, 'max_positions': 1},
            brier: 0.2,
          ));
      final byTitle = {for (final g in metricGroups(r)) g.title: g};
      expect(byTitle['Costs']!.rows, [
        const MetricRow(
            label: 'Costs paid', text: '\$12.50', sub: '1.04% of start'),
      ]);
      final discipline = byTitle['Discipline']!.rows;
      expect(
        discipline[0],
        const MetricRow(label: 'Risk blocks', bars: [
          MetricBar(label: 'sector', value: 2),
          MetricBar(label: 'max_positions', value: 1),
        ]),
      );
      expect(discipline[1],
          const MetricRow(label: 'Brier', text: '0.200', sub: 'lower is better'));
      expect(
        byTitle['Return and risk']!.rows.firstWhere((x) => x.label == 'Sharpe'),
        const MetricRow(label: 'Sharpe', text: '1.20'),
      );
    });

    test('is empty before the first close with no fills', () {
      expect(metricGroups(_run('z')), isEmpty);
    });

    test('shows a Fees row only when regulatory fees are above zero', () {
      final withFees = _run('a',
          equity: [_point('1', 1100)],
          metrics: _metrics(
              costsPaid: 12.54, costsPct: 1.25, feesPaid: 0.04));
      expect(
        metricGroups(withFees)
            .firstWhere((g) => g.title == 'Costs')
            .rows,
        [
          const MetricRow(
              label: 'Costs paid', text: '\$12.54', sub: '1.25% of start'),
          const MetricRow(label: 'Fees', text: '\$0.04'),
        ],
      );
      final zeroFees = _run('b',
          equity: [_point('1', 1100)],
          metrics:
              _metrics(costsPaid: 12.5, costsPct: 1.25, feesPaid: 0));
      expect(
        metricGroups(zeroFees)
            .firstWhere((g) => g.title == 'Costs')
            .rows
            .map((r) => r.label),
        isNot(contains('Fees')),
      );
      final noFees = _run('c',
          equity: [_point('1', 1100)],
          metrics: _metrics(costsPaid: 12.5, costsPct: 1.25));
      expect(
        metricGroups(noFees)
            .firstWhere((g) => g.title == 'Costs')
            .rows
            .map((r) => r.label),
        isNot(contains('Fees')),
      );
    });
  });

  group('fillCost', () {
    SimFill fill({double? cost, double? fees}) => SimFill(
          at: 1,
          date: '2026-10-26',
          symbol: 'SPY',
          side: OrderSide.buy,
          quantity: 1,
          price: 500,
          orderId: 'o1',
          cost: cost,
          fees: fees,
        );

    test('adds spread cost and regulatory fees into one full cost', () {
      expect(fillCost(fill(cost: 0.1, fees: 0.04)), closeTo(0.14, 1e-9));
    });

    test('tolerates a fill that records only one of the two', () {
      expect(fillCost(fill(cost: 0.1)), closeTo(0.1, 1e-9));
      expect(fillCost(fill(fees: 0.04)), closeTo(0.04, 1e-9));
    });

    test('is undefined when the fill records neither', () {
      expect(fillCost(fill()), isNull);
    });
  });

  group('comparisonReading', () {
    SimSuite suite(double meanDiff, List<double> ci95) => _suite(
          's',
          variants: const [SimVariant(label: 'A'), SimVariant(label: 'B')],
          comparison: SimComparison(
            metric: 'excessReturnPct',
            meanDiff: meanDiff,
            ci95: ci95,
            pairs: 2,
          ),
        );

    test('reads an inconclusive lead plainly', () {
      expect(
        comparisonReading(suite(0.8, [-0.3, 1.9])),
        const ComparisonReading(
          text:
              'B beat A by 0.8 points; 95% interval \u22120.3 to 1.9; not conclusive',
          conclusive: false,
        ),
      );
    });

    test('calls an interval that excludes zero conclusive, either direction', () {
      expect(comparisonReading(suite(1.4, [0.2, 2.6]))?.conclusive, isTrue);
      expect(
        comparisonReading(suite(-1.1, [-2.0, -0.2])),
        const ComparisonReading(
          text:
              'A beat B by 1.1 points; 95% interval \u22122.0 to \u22120.2; conclusive',
          conclusive: true,
        ),
      );
    });

    test('is null with no comparison', () {
      expect(comparisonReading(_suite('s')), isNull);
    });
  });

  group('alias reveal', () {
    SimRun blind() => _run('b',
        status: SimRunStatus.done,
        config: _cfg(mode: SimMode.blind),
        aliases: const {'QX1': 'SPY'});

    test('maps aliases to real symbols only when revealed', () {
      final r = blind();
      expect(shownSymbol(r, 'QX1', false), 'QX1');
      expect(shownSymbol(r, 'QX1', true), 'SPY');
      expect(shownSymbol(r, 'MSFT', true), 'MSFT');
    });

    test('is only offered on finished runs that carry aliases', () {
      expect(canReveal(blind()), isTrue);
      expect(canReveal(_run('a')), isFalse);
      expect(
        canReveal(_run('c',
            status: SimRunStatus.running, aliases: const {'QX1': 'SPY'})),
        isFalse,
      );
    });

    test('tags blind and bootstrap headers', () {
      expect(envBadge(blind()), 'Blind \u00b7 fictional dates');
      expect(
        envBadge(_run('d', config: _cfg(mode: SimMode.bootstrap), seed: 7)),
        'Bootstrap \u00b7 seed 7',
      );
      expect(envBadge(_run('e')), isNull);
    });

    test('derives excess return from finished metrics', () {
      expect(
        excessReturn(_run('a',
            metrics: _metrics(returnPct: 5, benchmarkReturnPct: 1))),
        closeTo(4, 1e-9),
      );
      expect(excessReturn(_run('a')), isNull);
    });
  });
}
