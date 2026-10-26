import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('sim_parsesRunList', () {
    final list =
        jsonDecode(File('test/fixtures/sim_runs.json').readAsStringSync())
            as List;
    final runs =
        list.map((r) => SimRun.fromJson(r as Map<String, dynamic>)).toList();

    expect(runs, hasLength(2));
    expect(runs.first.status, SimRunStatus.done);
    expect(runs.first.config.mode, SimMode.blind);
    expect(runs.first.config.execution, SimExecution.realistic);
    expect(runs.first.config.days, 60);
    expect(runs.first.config.startingCash, closeTo(1200, 1e-9));
    expect(runs.first.progress.day, 60);
    expect(runs.first.metrics, isNotNull);
  });

  test('sim_parsesFullRun', () {
    final json =
        jsonDecode(File('test/fixtures/sim_run.json').readAsStringSync())
            as Map<String, dynamic>;
    final run = SimRun.fromJson(json);

    expect(run.variant, 'B RSI-only filter');
    expect(run.suiteId, '20261025040559417-c74d1b');
    expect(run.equity, hasLength(5));
    expect(run.equity.last.equity, greaterThan(0));
  });

  test('sim_copyWithReplacesStatus', () {
    final json =
        jsonDecode(File('test/fixtures/sim_run.json').readAsStringSync())
            as Map<String, dynamic>;
    final run = SimRun.fromJson(json);

    final stopped = run.copyWith(status: SimRunStatus.stopped);

    expect(stopped.status, SimRunStatus.stopped);
    expect(stopped.id, run.id);
    expect(stopped.equity, run.equity);
  });

  test('sim_parsesSuite', () {
    final list =
        jsonDecode(File('test/fixtures/sim_suites.json').readAsStringSync())
            as List;
    final suite = SimSuite.fromJson(list.single as Map<String, dynamic>);

    expect(suite.config.name, contains('pilot'));
    expect(
      suite.config.variants.map((v) => v.label).toList(),
      ['A current OR rule', 'B RSI-only filter'],
    );
    expect(suite.summary.map((s) => s.label).toList(), [
      'A current OR rule',
      'B RSI-only filter',
    ]);
    expect(suite.comparison, isNotNull);
    expect(suite.comparison!.metric, 'excessReturnPct');
    expect(suite.comparison!.pairs, 3);
    expect(suite.runs.length, lessThanOrEqualTo(5));
  });

  test('sim_parsesScenarios', () {
    final list =
        jsonDecode(File('test/fixtures/sim_scenarios.json').readAsStringSync())
            as List;
    final scenarios = list
        .map((s) => SimScenario.fromJson(s as Map<String, dynamic>))
        .toList();

    expect(scenarios, hasLength(3));
    expect(scenarios.first.id, 'volmageddon-2018');
    expect(scenarios.first.regime, SimRegime.shock);
    expect(scenarios.first.days, 35);
  });
}
