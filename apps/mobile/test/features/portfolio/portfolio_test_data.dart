import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

Object? _fixture(String name) => jsonDecode(File('test/fixtures/$name').readAsStringSync());

StatusResponse fixtureStatus() => StatusResponse.fromJson(_fixture('status.json')! as Map<String, dynamic>);
EquityHistory fixtureEquity() => EquityHistory.fromJson(_fixture('equity_3m.json')! as Map<String, dynamic>);
PerformanceSummary fixturePerformance() =>
    PerformanceSummary.fromJson(_fixture('performance.json')! as Map<String, dynamic>);
List<ReportSummary> fixtureReports() =>
    [for (final r in _fixture('reports.json')! as List<dynamic>) ReportSummary.fromJson(r as Map<String, dynamic>)];

/// Two equity marks that start on Oct 1 with the given returns.
EquityHistory equityWith({required double returnPct, double? benchmarkReturnPct}) => EquityHistory(
      points: const [
        EquityPoint(at: 1, date: '2026-10-01', equity: 1000, benchmark: 1000),
        EquityPoint(at: 2, date: '2026-10-02', equity: 1032, benchmark: 1021),
      ],
      holdingsReplay: const [],
      returnPct: returnPct,
      benchmarkReturnPct: benchmarkReturnPct,
    );

/// A started harness whose API serves the fixtures. [configure] overrides
/// handlers before the first refresh.
Future<StoreHarness> openHarness(
  WidgetTester tester, {
  StatusResponse? status,
  List<OrderRecord> orders = const [],
  List<ReportSummary>? reports,
  EquityHistory? equity,
  void Function(FakeApi api)? configure,
}) async {
  final api = FakeApi()..defaults();
  api
    ..on('status', () async => status ?? fixtureStatus())
    ..on('orders', () async => orders)
    ..on('equity', () async => equity ?? fixtureEquity())
    ..on('performance', () async => fixturePerformance())
    ..on('reports', () async => reports ?? fixtureReports());
  configure?.call(api);
  // The store refreshes as soon as it is created, so handlers come first.
  final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
  addTearDown(h.dispose);
  await tester.runAsync(h.start);
  return h;
}

/// Lets queued futures and short animations run without waiting for the
/// looping skeleton shimmer to settle.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}
