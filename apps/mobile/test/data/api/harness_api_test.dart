import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:longbow/data/api/harness_api.dart';
import 'package:longbow/data/api/status_cache.dart';
import 'package:longbow/models/models.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> _riskJson() => {
      'maxRiskPerTradePct': 1.5,
      'maxPositionPct': 30.0,
      'maxSectorPct': 60.0,
      'maxPositions': 4,
      'maxOrderNotionalUsd': 500.0,
      'minOrderNotionalUsd': 5.0,
      'dailyLossHaltPct': 3.0,
      'monthlyDrawdownHaltPct': 8.0,
      'maxEntriesPerDay': 2,
      'minHoldDays': 1,
      'maxSpreadBps': 20.0,
      'maxSlippageBps': 10.0,
      'noTradeOpenMinutes': 30,
      'noTradeCloseMinutes': 15,
      'maxDayTrades5d': 3,
      'minEvToCost': 2.0,
      'earningsBlackoutDays': 5,
      'minAvgDollarVolumeUsd': 20000000.0,
    };

Map<String, dynamic> _statusJson() => {
      'agent': {'state': 'running', 'model': 'main'},
      'broker': {'state': 'connected', 'tools': ['prices']},
      'market': {
        'now': 1,
        'session': 'regular',
        'isOpen': true,
        'tradingDay': '2026-10-26',
        'nextOpen': 2,
        'nextClose': 3,
        'earlyClose': false,
      },
      'settings': {
        'mode': 'auto',
        'killSwitch': false,
        'drawdownHalted': false,
        'cycleMinutesOpen': 30,
        'cycleMinutesClosed': 240,
        'watchlist': ['SPY'],
        'risk': _riskJson(),
      },
      'account': null,
      'halts': [],
      'liveTrading': false,
      'models': {'main': 'a', 'subagents': 'b'},
    };

Map<String, dynamic> _orderJson(String id) => {
      'id': id,
      'createdAt': 10,
      'updatedAt': 11,
      'intent': {
        'symbol': 'SPY',
        'side': 'buy',
        'quantity': 2.0,
        'orderType': 'limit',
        'limitPrice': 500.0,
        'timeInForce': 'day',
        'invalidationPrice': 490.0,
        'timeStopDate': '2026-10-30',
        'thesis': 'trend',
        'probabilityWin': 0.6,
        'expectedGainPct': 2.0,
        'expectedLossPct': 1.0,
        'estimatedCostPct': 0.1,
        'evidence': ['tape'],
      },
      'verdict': {'approved': true, 'isExit': false, 'checks': []},
      'status': 'pending_approval',
    };

void main() {
  test('GET sends accept without CSRF; POST adds the CSRF header', () async {
    http.Request? seenGet;
    http.Request? seenPost;
    final api = HttpHarnessApi(
      Uri.parse('https://longbow.example.ts.net:8443'),
      MockClient((request) async {
        if (request.method == 'GET') seenGet = request;
        if (request.method == 'POST') seenPost = request;
        return http.Response('[]', 200);
      }),
    );
    await api.journal(100);
    await api.runCycle();
    expect(seenGet!.headers['accept'], 'application/json');
    expect(seenGet!.headers.containsKey('x-harness'), isFalse);
    expect(seenPost!.headers['x-harness'], '1');
    expect(seenPost!.headers['content-type'], contains('application/json'));
    expect(seenPost!.headers.containsKey('origin'), isFalse);
  });

  test('status parses and persists its raw body to the status cache',
      () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final api = HttpHarnessApi(
      Uri.parse('https://longbow.example.ts.net:8443'),
      MockClient((_) async => http.Response(jsonEncode(_statusJson()), 200)),
      statusCache: StatusCacheForTest(prefs),
    );
    final status = await api.status();
    expect(status.agent.state, AgentState.running);
    expect(status.broker.tools, ['prices']);
    final cached = prefs.getString('status.cache');
    expect(cached, contains('"running"'));
    expect(jsonDecode(cached!)['status']['agent']['model'], 'main');
  });

  test('error extraction prefers error, then message, then raw text',
      () async {
    Future<String> messageFor(Object body) async {
      final api = HttpHarnessApi(
        Uri.parse('https://longbow.example.ts.net:8443'),
        MockClient((_) async => http.Response(
            body is String ? body : jsonEncode(body), 400)),
      );
      try {
        await api.runCycle();
      } on ApiError catch (e) {
        return '${e.status}:${e.message}';
      }
      throw StateError('expected ApiError');
    }

    expect(await messageFor({'error': 'nope'}), '400:nope');
    expect(
        await messageFor({'message': 'fell over'}), '400:fell over');
    expect(await messageFor('plain failure'), '400:plain failure');
    expect(await messageFor(''), '400:Request failed (400)');
    // A JSON array carries no error/message, so the raw text stands.
    expect(await messageFor([]), '400:[]');
  });

  test('network failure becomes status 0 with the unreachable message',
      () async {
    final api = HttpHarnessApi(
      Uri.parse('https://longbow.example.ts.net:8443'),
      MockClient((_) async => throw http.ClientException('down')),
    );
    try {
      await api.status();
      fail('expected ApiError');
    } on ApiError catch (e) {
      expect(e.status, 0);
      expect(e.message, 'Cannot reach the harness server');
    }
  });

  test('path segments are encoded; note paths encode per segment', () async {
    final paths = <String>[];
    final api = HttpHarnessApi(
      Uri.parse('https://longbow.example.ts.net:8443'),
      MockClient((request) async {
        paths.add(request.url.path);
        return http.Response(
            '{"name":"s","description":"d","body":"b","files":[]}', 200);
      }),
    );
    await api.skill('my skill');
    expect(paths.single, '/api/skills/my%20skill');
  });

  test('note path encodes each segment but keeps slashes', () async {
    String? seen;
    final api = HttpHarnessApi(
      Uri.parse('https://longbow.example.ts.net:8443'),
      MockClient((request) async {
        seen = request.url.path;
        return http.Response(
            '{"path":"x","content":"c","updatedAt":1}', 200);
      }),
    );
    final note = await api.note('theses/my note.md');
    expect(seen, '/api/notes/theses/my%20note.md');
    expect(note.content, 'c');
  });

  test('reports builds the query only from the given filters', () async {
    final urls = <Uri>[];
    final api = HttpHarnessApi(
      Uri.parse('https://longbow.example.ts.net:8443'),
      MockClient((request) async {
        urls.add(request.url);
        return http.Response('[]', 200);
      }),
    );
    await api.reports(kind: ReportKind.daily, limit: 5);
    await api.reports();
    expect(urls[0].queryParameters, {'kind': 'daily', 'limit': '5'});
    expect(urls[1].queryParameters, isEmpty);
  });

  test('history sends the wire range; simMessages adds conversationId',
      () async {
    final urls = <Uri>[];
    final api = HttpHarnessApi(
      Uri.parse('https://longbow.example.ts.net:8443'),
      MockClient((request) async {
        urls.add(request.url);
        if (request.url.path.contains('history')) {
          return http.Response(
              '{"symbol":"SPY","bars":[],"source":"t","asOf":1}', 200);
        }
        return http.Response('[]', 200);
      }),
    );
    final history = await api.history('SPY', HistoryRange.sixMonths);
    expect(urls[0].queryParameters['range'], '6m');
    expect(history.symbol, 'SPY');
    await api.simMessages('r1', conversationId: 'c1');
    expect(urls[1].queryParameters['conversationId'], 'c1');
    await api.simMessages('r1');
    expect(urls[2].queryParameters.containsKey('conversationId'), isFalse);
  });

  test('approve returns null on an empty body and parses an order',
      () async {
    var calls = 0;
    final api = HttpHarnessApi(
      Uri.parse('https://longbow.example.ts.net:8443'),
      MockClient((_) async {
        calls++;
        return calls == 1
            ? http.Response('', 200)
            : http.Response(jsonEncode(_orderJson('o9')), 200);
      }),
    );
    expect(await api.approve('o1'), isNull);
    final order = await api.approve('o9');
    expect(order!.id, 'o9');
    expect(order.status, OrderStatus.pendingApproval);
    expect(order.intent.symbol, 'SPY');
  });

  test('reject sends an empty object without a reason', () async {
    final bodies = <String>[];
    final api = HttpHarnessApi(
      Uri.parse('https://longbow.example.ts.net:8443'),
      MockClient((request) async {
        bodies.add(request.body);
        return http.Response('', 200);
      }),
    );
    await api.reject('o1');
    await api.reject('o2', 'too big');
    expect(jsonDecode(bodies[0]), isEmpty);
    expect(jsonDecode(bodies[1]), {'reason': 'too big'});
  });

  test('pushTest parses sent and removed counts', () async {
    final api = HttpHarnessApi(
      Uri.parse('https://longbow.example.ts.net:8443'),
      MockClient((_) async =>
          http.Response('{"sent":2,"removed":1}', 200)),
    );
    final result = await api.pushTest();
    expect(result.sent, 2);
    expect(result.removed, 1);
  });
}

// The StatusCache constructor takes SharedPreferences; this alias keeps the
// import list honest (no test-only subclass needed).
class StatusCacheForTest extends StatusCache {
  StatusCacheForTest(super.prefs);
}
