import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

Object _json(String file) =>
    jsonDecode(File('test/fixtures/$file').readAsStringSync()) as Object;

List<SimRun> fixtureRuns() => (_json('sim_runs.json') as List)
    .map((e) => SimRun.fromJson(e as Map<String, dynamic>))
    .toList();

List<SimSuite> fixtureSuites() => (_json('sim_suites.json') as List)
    .map((e) => SimSuite.fromJson(e as Map<String, dynamic>))
    .toList();

List<SimScenario> fixtureScenarios() => (_json('sim_scenarios.json') as List)
    .map((e) => SimScenario.fromJson(e as Map<String, dynamic>))
    .toList();

/// The raw JSON of the single-run fixture.
Map<String, dynamic> fixtureRunJson() =>
    Map<String, dynamic>.of(_json('sim_run.json') as Map<String, dynamic>);

/// The single-run fixture (a finished blind run with aliases), with top-level
/// keys of [patch] replaced before parsing.
SimRun fixtureRun([Map<String, dynamic> patch = const {}]) =>
    SimRun.fromJson(fixtureRunJson()..addAll(patch));

Map<String, dynamic> fillJson({
  String symbol = 'MKT',
  String side = 'buy',
  String date = '2031-03-27',
  double cost = 0.05,
  double fees = 0.01,
}) => {
  'at': 1,
  'date': date,
  'symbol': symbol,
  'side': side,
  'quantity': 2,
  'price': 500,
  'orderId': 'o-$symbol-$side',
  'mid': 499.9,
  'cost': cost,
  'fees': fees,
};

Map<String, dynamic> positionJson(String symbol) => {
  'symbol': symbol,
  'quantity': 1,
  'averageCost': 100,
  'marketValue': 105,
  'unrealizedPnl': 5,
};

/// A harness whose fake API serves the given lab data. Loads runs, suites and
/// scenarios into the sim store before any widget is pumped.
Future<StoreHarness> labHarness(
  WidgetTester tester, {
  List<SimRun>? runs,
  List<SimSuite>? suites,
  List<SimScenario>? scenarios,
  bool start = false,
}) async {
  final h = (await tester.runAsync(StoreHarness.create))!;
  addTearDown(h.dispose);
  h.api.on('simRuns', () async => runs ?? fixtureRuns());
  h.api.on('simSuites', () async => suites ?? fixtureSuites());
  h.api.on('simScenarios', () async => scenarios ?? fixtureScenarios());
  h.api.on('simMessages', () async => <ChatMessage>[]);
  h.api.on('simJournal', () async => <JournalEntry>[]);
  h.api.on('simOrders', () async => <OrderRecord>[]);
  if (start) await tester.runAsync(h.start);
  await tester.runAsync(() async {
    await h.simStore.loadRuns();
    await h.simStore.loadScenarios();
  });
  return h;
}

/// Pumps a few frames. Never pumpAndSettle: running runs keep a pulse dot
/// animating forever.
Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await tester.pump(const Duration(milliseconds: 400));
}

/// Scrolls the nearest vertical scrollable until [finder] is built and visible.
Future<void> reveal(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
}

/// A button that opens a sheet or page under test.
Widget launcher(Future<void> Function(BuildContext context) open) => Scaffold(
  body: Builder(
    builder: (context) => Center(
      child: FilledButton(
        onPressed: () => open(context),
        child: const Text('Open'),
      ),
    ),
  ),
);
