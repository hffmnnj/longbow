/// Dev tool: fetches every GET endpoint from a locally running server (127.0.0.1:4520) and parses it with the
/// Dart models, so contract drift or old stored data that the models reject shows up before a device does.
/// Run: dart run tool/live_probe.dart
// ignore_for_file: avoid_print
library;

import 'dart:convert';
import 'dart:io';
import 'package:longbow/models/models.dart';

final client = HttpClient();
int ok = 0, bad = 0;

Future<dynamic> get(String path) async {
  final req = await client.getUrl(Uri.parse('http://127.0.0.1:4520$path'));
  final res = await req.close();
  final body = await res.transform(utf8.decoder).join();
  if (res.statusCode != 200) throw 'HTTP ${res.statusCode}';
  return jsonDecode(body);
}

Future<void> check(String name, String path, void Function(dynamic) parse) async {
  try {
    parse(await get(path));
    ok++;
  } catch (e, st) {
    bad++;
    print('FAIL $name ($path): $e');
    print(st.toString().split('\n').take(3).join('\n'));
  }
}

List<Map<String, dynamic>> L(dynamic j) => (j as List).cast<Map<String, dynamic>>();

Future<void> main() async {
  await check('status', '/api/status', (j) => StatusResponse.fromJson(j));
  await check('settings', '/api/settings', (j) => Settings.fromJson(j));
  await check('messages', '/api/messages?limit=200', (j) => L(j).forEach(ChatMessage.fromJson));
  await check('journal', '/api/journal?limit=500', (j) => L(j).forEach(JournalEntry.fromJson));
  await check('orders', '/api/orders?limit=500', (j) => L(j).forEach(OrderRecord.fromJson));
  await check('subagents', '/api/subagents', (j) => L(j).forEach(SubagentRun.fromJson));
  await check('skills', '/api/skills', (j) => L(j).forEach(SkillSummary.fromJson));
  await check('notes', '/api/notes', (j) => L(j).forEach(NoteFile.fromJson));
  await check('market', '/api/market/overview', (j) => MarketOverview.fromJson(j));
  await check('performance', '/api/analytics/performance', (j) => PerformanceSummary.fromJson(j));
  for (final r in ['1m', '3m', '1y', 'all']) {
    await check('equity $r', '/api/analytics/equity?range=$r', (j) => EquityHistory.fromJson(j));
  }
  for (final r in ['1m', '3m', '6m', '1y', '2y', '5y']) {
    await check('history SPY $r', '/api/market/history?symbol=SPY&range=$r', (j) => PriceHistory.fromJson(j));
  }
  final reports = L(await get('/api/reports'));
  for (final r in reports) { ReportSummary.fromJson(r); }
  for (final r in reports) {
    await check('report ${r['id']}', '/api/reports/${r['id']}', (j) => Report.fromJson(j));
  }
  final status = StatusResponse.fromJson(await get('/api/status'));
  final symbols = {...status.settings.watchlist, ...?status.account?.positions.map((p) => p.symbol)};
  for (final s in symbols) {
    await check('symbol $s', '/api/symbols/$s', (j) => SymbolDetail.fromJson(j));
  }
  await check('scenarios', '/api/sim/scenarios', (j) => L(j).forEach(SimScenario.fromJson));
  final runs = L(await get('/api/sim/runs'));
  for (final r in runs) {
    await check('run ${r['id']}', '/api/sim/runs/${r['id']}', (j) => SimRun.fromJson(j));
    await check('run msgs', '/api/sim/runs/${r['id']}/messages?limit=50', (j) => L(j).forEach(ChatMessage.fromJson));
    await check('run journal', '/api/sim/runs/${r['id']}/journal', (j) => L(j).forEach(JournalEntry.fromJson));
    await check('run orders', '/api/sim/runs/${r['id']}/orders', (j) => L(j).forEach(OrderRecord.fromJson));
  }
  await check('suites', '/api/sim/suites', (j) => L(j).forEach(SimSuite.fromJson));
  final msgs = L(await get('/api/messages?limit=200'));
  for (final m in msgs.where((m) => m['childConversationId'] != null).take(6)) {
    await check('conv ${m['childConversationId']}', '/api/conversations/${m['childConversationId']}/messages?limit=100', (j) => L(j).forEach(ChatMessage.fromJson));
  }
  print('probe done: $ok ok, $bad failed');
  client.close();
}
