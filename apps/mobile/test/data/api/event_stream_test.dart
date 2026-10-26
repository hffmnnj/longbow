import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:longbow/data/api/event_stream.dart';
import 'package:longbow/models/models.dart';

import '../fake_clock.dart';

String _frame(Map<String, dynamic> json) =>
    'data: ${jsonEncode(json)}\n\n';

Map<String, dynamic> _statusJson() => {
      'type': 'status',
      'status': {
        'agent': {'state': 'idle', 'model': 'm'},
        'broker': {'state': 'disconnected', 'tools': []},
        'market': {
          'now': 1,
          'session': 'closed',
          'isOpen': false,
          'tradingDay': '2026-10-26',
          'nextOpen': 2,
          'nextClose': 3,
          'earlyClose': false,
        },
        'settings': {
          'mode': 'off',
          'killSwitch': false,
          'drawdownHalted': false,
          'cycleMinutesOpen': 30,
          'cycleMinutesClosed': 240,
          'watchlist': <String>[],
          'risk': {
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
          },
        },
        'account': null,
        'halts': [],
        'liveTrading': false,
        'models': {'main': 'a', 'subagents': 'b'},
      },
    };

/// A client whose per-request response is scripted by the test: each request
/// gets its own chunk controller (or a one-shot failure) with no real time.
/// Every request MUST receive a fresh stream: re-listening to one
/// single-subscription stream throws, exactly as a second HTTP response would
/// never share the first response's body.
class ScriptClient extends http.BaseClient {
  ScriptClient(this.handler);

  final FutureOr<http.StreamedResponse> Function(int index) handler;
  int requests = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final index = requests++;
    return handler(index);
  }
}

/// Fresh never-closing streams for reconnects after the first request.
class ReconnectScripts {
  final List<StreamController<List<int>>> extra = [];

  http.StreamedResponse forRequest(
      int index, StreamController<List<int>> first) {
    if (index == 0) return openStream(first.stream);
    final controller = StreamController<List<int>>();
    extra.add(controller);
    return openStream(controller.stream);
  }

  Future<void> closeAll() async {
    for (final c in extra) {
      await c.close();
    }
  }
}

http.StreamedResponse openStream(Stream<List<int>> bytes,
        {int status = 200}) =>
    http.StreamedResponse(bytes, status);

void main() {
  group('SseParser', () {
    test('splits lines and multi-byte characters across chunks', () {
      final parser = SseParser();
      // "é" (2 bytes in UTF-8) split across chunks, plus a split line.
      final frame = _frame({
        'type': 'delta',
        'text': 'caf\u00e9',
      });
      final bytes = utf8.encode(frame);
      final part1 = bytes.sublist(0, 10);
      final part2 = bytes.sublist(10, 12);
      final part3 = bytes.sublist(12);
      // Split the two bytes of é (last two bytes of part boundary region).
      expect(parser.addBytes(part1), isEmpty);
      expect(parser.addBytes(part2), isEmpty);
      final events = parser.addBytes(part3);
      expect(events, hasLength(1));
      expect((events.single as DeltaEvent).text, 'caf\u00e9');
    });

    test('ignores comment pings, joins multi-line data, drops bad JSON',
        () {
      final parser = SseParser();
      final out = parser.addBytes(utf8.encode(
        ': ping\n'
        'data: {"type":\n'
        'data: "delta", "text": "hi"}\n'
        '\n'
        'data: not json\n'
        '\n'
        'data: {"type":"nope"}\n'
        '\n',
      ));
      expect(out, hasLength(1));
      expect((out.single as DeltaEvent).text, 'hi');
    });

    test('dispatches one event per blank line', () {
      final parser = SseParser();
      final out = parser.addBytes(utf8.encode(
        '${_frame({'type': 'delta', 'text': 'a'})}'
        '${_frame({'type': 'delta', 'text': 'b'})}',
      ));
      expect(out.map((e) => (e as DeltaEvent).text), ['a', 'b']);
    });
  });

  group('EventStream.backoffFor', () {
    test('doubles from 1s and caps at 15s plus jitter', () {
      expect(EventStream.backoffFor(0, 0), const Duration(seconds: 1));
      expect(EventStream.backoffFor(1, 0), const Duration(seconds: 2));
      expect(EventStream.backoffFor(2, 0), const Duration(seconds: 4));
      expect(EventStream.backoffFor(10, 0), const Duration(seconds: 15));
      expect(EventStream.backoffFor(100, 0), const Duration(seconds: 15));
      expect(EventStream.backoffFor(1, 400),
          const Duration(milliseconds: 2400));
    });
  });

  group('EventStream connection', () {
    late ManualClock clock;
    late List<Duration> waits;

    setUp(() {
      clock = ManualClock();
      waits = [];
    });

    Future<void> loggedDelay(Duration d) {
      waits.add(d);
      return clock.delay(d);
    }

    EventStream streamFor(
      ScriptClient client, {
      void Function(ServerEvent)? onEvent,
      void Function()? onOpen,
      void Function()? onClose,
    }) {
      return EventStream(
        baseUrl: Uri.parse('https://longbow.example.ts.net:8443'),
        client: client,
        onEvent: onEvent ?? (_) {},
        onOpen: onOpen ?? () {},
        onClose: onClose ?? () {},
        now: clock.call,
        delay: loggedDelay,
        jitterMillis: clock.noJitter,
      );
    }

    test('emits events and fires onOpen once per connection', () async {
      final controller = StreamController<List<int>>();
      final client = ScriptClient((_) => openStream(controller.stream));
      final events = <ServerEvent>[];
      var opens = 0;
      final stream = streamFor(client,
          onEvent: events.add, onOpen: () => opens++);
      stream.start();
      await clock.pump();
      expect(opens, 1);
      controller.add(utf8.encode(
          ': ping\n${_frame(_statusJson())}${_frame({'type': 'delta', 'text': 'hi'})}'));
      await clock.pump();
      expect(events, hasLength(2));
      expect(events[0], isA<StatusEvent>());
      expect((events[1] as DeltaEvent).text, 'hi');
      expect(opens, 1);
      await stream.dispose();
      await controller.close();
    });

    test('reconnects with backoff after the stream ends, reopening each time',
        () async {
      final first = StreamController<List<int>>();
      final second = StreamController<List<int>>();
      final client = ScriptClient((index) => openStream(
          index == 0 ? first.stream : second.stream));
      var opens = 0;
      var closes = 0;
      final stream = streamFor(client,
          onOpen: () => opens++, onClose: () => closes++);
      stream.start();
      await clock.pump();
      expect(opens, 1);
      await first.close(); // server ends the stream
      await clock.pump();
      expect(closes, 1);
      expect(client.requests, 1); // parked on the backoff delay
      // The first entry is the watchdog arm from the first connection; the
      // backoff for the first reconnect is exactly 1s (jitter is zeroed).
      expect(waits, [const Duration(seconds: 70), const Duration(seconds: 1)]);
      await clock.advance(const Duration(seconds: 1));
      expect(client.requests, 2);
      expect(opens, 2);
      await stream.dispose();
      await second.close();
    });

    test('a failed request retries without an onOpen', () async {
      final client = ScriptClient(
          (_) => openStream(const Stream.empty(), status: 500));
      var opens = 0;
      var closes = 0;
      final stream = streamFor(client,
          onOpen: () => opens++, onClose: () => closes++);
      stream.start();
      await clock.pump();
      expect(opens, 0);
      expect(closes, 1);
      await clock.advance(const Duration(seconds: 1));
      expect(client.requests, 2);
      expect(closes, 2);
      expect(waits, [
        const Duration(seconds: 1),
        const Duration(seconds: 2),
      ]);
      await stream.dispose();
    });

    test('watchdog drops a silent connection after 70 seconds', () async {
      final controller = StreamController<List<int>>();
      final scripts = ReconnectScripts();
      final client =
          ScriptClient((index) => scripts.forRequest(index, controller));
      var closes = 0;
      final stream = streamFor(client, onClose: () => closes++);
      stream.start();
      await clock.pump();
      expect(client.requests, 1);
      await clock.advance(const Duration(seconds: 69));
      expect(client.requests, 1);
      await clock.advance(const Duration(seconds: 2));
      expect(closes, 1);
      expect(client.requests, 2);
      await stream.dispose();
      await controller.close();
      await scripts.closeAll();
    });

    test('bytes reset the watchdog', () async {
      final controller = StreamController<List<int>>();
      final scripts = ReconnectScripts();
      final client =
          ScriptClient((index) => scripts.forRequest(index, controller));
      final stream = streamFor(client);
      stream.start();
      await clock.pump();
      await clock.advance(const Duration(seconds: 60));
      controller.add(utf8.encode(': ping\n'));
      await clock.pump();
      await clock.advance(const Duration(seconds: 60));
      expect(client.requests, 1); // ping 60s in counts as activity
      await stream.dispose();
      await controller.close();
      await scripts.closeAll();
    });

    test('dispose stops the reconnect loop', () async {
      final first = StreamController<List<int>>();
      final scripts = ReconnectScripts();
      final client =
          ScriptClient((index) => scripts.forRequest(index, first));
      final stream = streamFor(client);
      stream.start();
      await clock.pump();
      await first.close();
      await clock.pump();
      await stream.dispose();
      await clock.advance(const Duration(seconds: 30));
      expect(client.requests, 1);
      // Watchdog arm, then the 1s backoff that dispose cancelled.
      expect(waits, [const Duration(seconds: 70), const Duration(seconds: 1)]);
      await scripts.closeAll();
    });
  });
}
