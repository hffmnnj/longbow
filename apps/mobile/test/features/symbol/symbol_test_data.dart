import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

Object? _fixture(String name) => jsonDecode(File('test/fixtures/$name').readAsStringSync());

/// NVDA from the symbol fixture. [orders] and [journal] default to one filled
/// buy and seven decisions; pass empty lists for the empty state.
/// [held] false drops the position and the stop.
Map<String, dynamic> nvdaJson({bool orders = true, bool journal = true, bool held = true, bool thesis = true}) {
  final d = Map<String, dynamic>.from(_fixture('symbol_nvda.json')! as Map<String, dynamic>);
  final order = Map<String, dynamic>.from((_fixture('orders.json')! as List<dynamic>).first as Map<String, dynamic>);
  final intent = Map<String, dynamic>.from(order['intent'] as Map<String, dynamic>)..['symbol'] = 'NVDA';
  order
    ..['intent'] = intent
    ..['status'] = 'filled'
    ..['id'] = 'ord-nvda-1'
    // 2026-10-21 12:00 UTC, so the fill lands on the Oct 21 bar.
    ..['updatedAt'] = DateTime.utc(2026, 10, 21, 12).millisecondsSinceEpoch
    ..['filledQuantity'] = 0.65
    ..['averageFillPrice'] = 219.5;
  d['orders'] = orders ? [order] : <dynamic>[];
  final entry = (d['journal'] as List<dynamic>).first as Map<String, dynamic>;
  d['journal'] = journal
      ? [for (var i = 0; i < 7; i++) {...entry, 'id': 'j$i', 'at': 1000 + i}]
      : <dynamic>[];
  if (!held) {
    d.remove('position');
    d.remove('stop');
  }
  if (!thesis) d.remove('thesis');
  return d;
}

SymbolDetail nvdaDetail({bool orders = true, bool journal = true, bool held = true, bool thesis = true}) =>
    SymbolDetail.fromJson(nvdaJson(orders: orders, journal: journal, held: held, thesis: thesis));

/// A started harness serving [detail] and its own bars for every range.
Future<StoreHarness> openSymbolHarness(
  WidgetTester tester, {
  SymbolDetail? detail,
  void Function(FakeApi api)? configure,
}) async {
  final d = detail ?? nvdaDetail();
  final api = FakeApi()..defaults();
  api
    ..on('symbolDetail', () async => d)
    ..on('history', () async => d.history);
  configure?.call(api);
  // The store refreshes as soon as it is created, so handlers come first.
  final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
  addTearDown(h.dispose);
  await tester.runAsync(h.start);
  return h;
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}
