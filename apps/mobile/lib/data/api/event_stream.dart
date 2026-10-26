import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:longbow/models/models.dart';

import 'harness_api.dart';

/// Injectable clock and delay so connection tests run with no real time.
typedef NowFn = DateTime Function();
typedef DelayFn = Future<void> Function(Duration duration);

Future<void> _defaultDelay(Duration d) => Future.delayed(d);

/// Incremental SSE frame parser over a byte stream.
///
/// Bytes accumulate until a `\n` boundary; only complete lines are decoded,
/// so a UTF-8 character split across chunks is never torn. `data:` lines
/// accumulate into one event (multi-line events join with `\n`); a blank line
/// dispatches. Comment lines (`: ping`, which the server sends every 25 s)
/// and unknown fields are ignored. Malformed JSON frames are dropped, like
/// the web client's `catch { /* ignore malformed frame */ }`.
class SseParser {
  final List<int> _bytes = [];
  final List<String> _dataLines = [];
  final List<ServerEvent> _ready = [];

  /// Feeds one chunk and returns the newly completed events.
  List<ServerEvent> addBytes(List<int> chunk) {
    _bytes.addAll(chunk);
    var start = 0;
    for (var i = 0; i < _bytes.length; i++) {
      if (_bytes[i] != 0x0A) continue;
      var end = i;
      if (end > start && _bytes[end - 1] == 0x0D) end--;
      _handleLine(utf8.decode(_bytes.sublist(start, end)));
      start = i + 1;
    }
    if (start > 0) _bytes.removeRange(0, start);
    if (_ready.isEmpty) return const [];
    final out = List<ServerEvent>.of(_ready);
    _ready.clear();
    return out;
  }

  void _handleLine(String line) {
    if (line.isEmpty) {
      if (_dataLines.isNotEmpty) {
        final event = ServerEvent.tryParse(_dataLines.join('\n'));
        _dataLines.clear();
        if (event != null) _ready.add(event);
      }
      return;
    }
    if (line.startsWith(':')) return; // comment / heartbeat ping
    if (line.startsWith('data:')) {
      var value = line.substring(5);
      if (value.startsWith(' ')) value = value.substring(1);
      _dataLines.add(value);
      return;
    }
    // `event:`, `id:`, `retry:` and anything else: ignored.
  }
}

/// Live GET /api/events stream with the web client's reconnect behavior:
/// `onOpen` fires on every connect and reconnect, `onEvent` per parsed
/// event, `onClose` when a connection drops (never on [dispose]).
///
/// Reconnect waits `min(15s, 1s * 2^attempt)` plus up to 400 ms of jitter and
/// resets the attempt counter on a successful open. A watchdog drops a
/// connection that yields no bytes — heartbeats included — for
/// [watchdogTimeout] (70 s default).
class EventStream {
  EventStream({
    required this.baseUrl,
    required this.client,
    required this.onEvent,
    required this.onOpen,
    required this.onClose,
    NowFn? now,
    DelayFn? delay,
    double Function()? jitterMillis,
    this.watchdogTimeout = const Duration(seconds: 70),
    this.requestTimeout = const Duration(seconds: 15),
  })  : _now = now ?? DateTime.now,
        _delay = delay ?? _defaultDelay,
        _jitterMillis =
            jitterMillis ?? (() => Random().nextDouble() * 400);

  final Uri baseUrl;
  final http.Client client;
  final void Function(ServerEvent event) onEvent;
  final void Function() onOpen;
  final void Function() onClose;
  final NowFn _now;
  final DelayFn _delay;
  final double Function() _jitterMillis;
  final Duration watchdogTimeout;
  final Duration requestTimeout;

  bool _started = false;
  bool _closed = false;
  int _attempt = 0;
  Completer<void>? _wakeOnDispose;

  /// Backoff before reconnect attempt number [attempt] (0-based): the web
  /// formula `min(15s, 1s * 2^attempt)` plus [jitterMs] (0..400).
  static Duration backoffFor(int attempt, double jitterMs) {
    final capped = attempt >= 14 ? 15000 : min(15000, 1000 * (1 << attempt));
    return Duration(milliseconds: capped + jitterMs.round());
  }

  /// Opens the stream and starts the reconnect loop. Idempotent.
  void start() {
    if (_started) return;
    _started = true;
    _wakeOnDispose = Completer<void>();
    unawaited(_loop());
  }

  Future<void> dispose() async {
    _closed = true;
    _wakeOnDispose?.complete();
  }

  Future<void> _loop() async {
    while (!_closed) {
      try {
        await _connectOnce();
      } catch (_) {
        // Connection failed or dropped: fall through to reconnect.
      }
      if (_closed) return;
      onClose();
      final wait = backoffFor(_attempt, _jitterMillis());
      _attempt++;
      await _delay(wait);
    }
  }

  Future<void> _connectOnce() async {
    final request = http.Request('GET', baseUrl.replace(path: '/api/events'))
      ..headers['accept'] = 'text/event-stream';
    final http.StreamedResponse response;
    try {
      response = await client.send(request).timeout(requestTimeout);
    } on Exception {
      throw ApiError(0, 'Cannot reach the harness server');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      await response.stream.drain<void>();
      throw ApiError(response.statusCode, 'Events stream failed');
    }
    // A successful open resets the backoff, exactly like EventSource.onopen.
    _attempt = 0;
    onOpen();

    final parser = SseParser();
    final iterator = StreamIterator(response.stream);
    var lastActivity = _now();
    Future<bool>? pendingNext;
    try {
      while (!_closed) {
        final remaining = lastActivity.add(watchdogTimeout).difference(_now());
        if (remaining <= Duration.zero) throw const _WatchdogExpired();
        pendingNext ??= iterator.moveNext();
        final outcome = await Future.any([
          pendingNext.then((_) => _ReadResult.chunk),
          _delay(remaining).then((_) => _ReadResult.timeout),
          _wakeOnDispose!.future.then((_) => _ReadResult.aborted),
        ]);
        if (outcome == _ReadResult.aborted) return;
        if (outcome == _ReadResult.timeout) {
          await iterator.cancel();
          throw const _WatchdogExpired();
        }
        final has = await pendingNext;
        pendingNext = null;
        if (!has) throw const _StreamEnded();
        lastActivity = _now();
        for (final event in parser.addBytes(iterator.current)) {
          onEvent(event);
        }
      }
    } finally {
      await iterator.cancel();
    }
  }
}

enum _ReadResult { chunk, timeout, aborted }

class _WatchdogExpired implements Exception {
  const _WatchdogExpired();
}

class _StreamEnded implements Exception {
  const _StreamEnded();
}
