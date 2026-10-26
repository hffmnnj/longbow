import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:longbow/models/models.dart';

import 'status_cache.dart';

/// Error for a failed harness request. Mirrors the web `ApiError`:
/// `status` is the HTTP status, or 0 when the server could not be reached.
class ApiError implements Exception {
  const ApiError(this.status, this.message);

  final int status;
  final String message;

  @override
  String toString() => 'ApiError($status): $message';
}

/// Robinhood sign-in URL the UI opens in a browser. Mirrors `ConnectResponse`.
class ConnectResponse {
  const ConnectResponse({required this.url});

  factory ConnectResponse.fromJson(Map<String, dynamic> json) =>
      ConnectResponse(url: json['url'] as String);

  final String url;
}

/// Result of POST /api/push/test: how many native pushes were sent and pruned.
class PushTestResult {
  const PushTestResult({required this.sent, required this.removed});

  factory PushTestResult.fromJson(Map<String, dynamic> json) => PushTestResult(
        sent: (json['sent'] as num?)?.toInt() ?? 0,
        removed: (json['removed'] as num?)?.toInt() ?? 0,
      );

  final int sent;
  final int removed;
}

/// One method per web `Api` method in apps/web/src/lib/api.ts, minus the
/// web-push endpoints (the native app uses the Kotlin foreground service)
/// and minus `subscribe` (live events arrive through [EventStream]).
/// See lib/data/api/event_stream.dart.
abstract class HarnessApi {
  /// The server this client talks to.
  Uri get baseUrl;

  Future<StatusResponse> status();
  Future<List<ChatMessage>> messages([int limit = 200]);
  Future<void> sendMessage(String text);
  Future<void> runCycle();
  Future<List<JournalEntry>> journal([int limit = 100]);
  Future<List<OrderRecord>> orders([int limit = 100]);
  Future<OrderRecord?> approve(String id);
  Future<OrderRecord?> reject(String id, [String? reason]);
  Future<Settings> settings();
  Future<Settings?> patchSettings(SettingsPatch patch);
  Future<ConnectResponse> connectUrl();
  Future<void> disconnect();
  Future<List<SubagentRun>> subagents();
  Future<List<ChatMessage>> conversationMessages(String id, [int limit = 200]);
  Future<List<SkillSummary>> skills();
  Future<Skill> skill(String name);
  Future<List<NoteFile>> notes();
  Future<NoteContent> note(String path);
  Future<PriceHistory> history(String symbol, HistoryRange range);
  Future<EquityHistory> equity(AnalyticsRange range);
  Future<PerformanceSummary> performance();
  Future<List<ReportSummary>> reports({ReportKind? kind, int? limit});
  Future<Report> report(String id);
  Future<MarketOverview> marketOverview();
  Future<SymbolDetail> symbolDetail(String symbol);
  Future<List<SimRun>> simRuns();
  Future<SimRun> simRun(String id);
  Future<SimRun> simStart(SimRunConfig config);
  Future<SimRun?> simStop(String id);
  Future<List<SimScenario>> simScenarios();
  Future<List<SimSuite>> simSuites();
  Future<SimSuite> simSuite(String id);
  Future<SimSuite> simSuiteStart(SimSuiteConfig config);
  Future<SimSuite?> simSuiteStop(String id);
  Future<List<ChatMessage>> simMessages(String id,
      {int limit = 200, String? conversationId});
  Future<List<JournalEntry>> simJournal(String id);
  Future<List<OrderRecord>> simOrders(String id);
  Future<PushTestResult> pushTest();
}

String historyRangeWire(HistoryRange range) => switch (range) {
      HistoryRange.oneMonth => '1m',
      HistoryRange.threeMonths => '3m',
      HistoryRange.sixMonths => '6m',
      HistoryRange.oneYear => '1y',
      HistoryRange.twoYears => '2y',
      HistoryRange.fiveYears => '5y',
    };

String analyticsRangeWire(AnalyticsRange range) => switch (range) {
      AnalyticsRange.oneMonth => '1m',
      AnalyticsRange.threeMonths => '3m',
      AnalyticsRange.oneYear => '1y',
      AnalyticsRange.all => 'all',
    };

/// JSON over HTTP against one harness server. Every non-GET request carries
/// the `x-harness: 1` CSRF header and no `Origin` header, which is what the
/// server accepts from the native app.
class HttpHarnessApi implements HarnessApi {
  HttpHarnessApi(
    this.baseUrl,
    this.client, {
    this.statusCache,
    this.timeout = const Duration(seconds: 15),
  });

  @override
  final Uri baseUrl;
  final http.Client client;

  /// When set, the raw body of every successful GET /api/status is persisted
  /// so an offline launch can show the last known account.
  final StatusCache? statusCache;
  final Duration timeout;

  Uri _url(String path, [Map<String, String>? query]) =>
      baseUrl.replace(path: path, queryParameters: query);

  Future<http.Response> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    final request = http.Request(method, _url(path, query))
      ..headers['accept'] = 'application/json';
    if (method != 'GET') request.headers['x-harness'] = '1';
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    try {
      final streamed = await client.send(request).timeout(timeout);
      return await http.Response.fromStream(streamed);
    } on ApiError {
      rethrow;
    } on Exception {
      throw const ApiError(0, 'Cannot reach the harness server');
    }
  }

  Never _throw(int status, String text) {
    throw ApiError(status, _extractMessage(status, text));
  }

  /// Same message extraction as the web `toError`: `error`, then `message`,
  /// then the raw text (first 200 chars), then a status fallback.
  static String _extractMessage(int status, String text) {
    try {
      final data = jsonDecode(text);
      if (data is Map<String, dynamic>) {
        final error = data['error'];
        if (error is String && error.isNotEmpty) return error;
        final message = data['message'];
        if (message is String && message.isNotEmpty) return message;
      }
    } catch (_) {
      // Not JSON: fall through to the raw text.
    }
    final trimmed = text.trim();
    if (trimmed.isNotEmpty) return trimmed.substring(0, trimmed.length > 200 ? 200 : trimmed.length);
    return 'Request failed ($status)';
  }

  Future<T> _get<T>(String path,
      {Map<String, String>? query,
      required T Function(Object? json) parse}) async {
    final res = await _send('GET', path, query: query);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      _throw(res.statusCode, res.body);
    }
    if (res.body.isEmpty) return parse(null);
    return parse(jsonDecode(res.body));
  }

  Future<T> _mutate<T>(String method, String path,
      {Object? body, required T Function(Object? json) parse}) async {
    final res = await _send(method, path, body: body);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      _throw(res.statusCode, res.body);
    }
    if (res.body.isEmpty) return parse(null);
    return parse(jsonDecode(res.body));
  }

  static List<T> _list<T>(
      Object? json, T Function(Map<String, dynamic>) fromJson) {
    if (json is! List) throw const ApiError(200, 'Unexpected response shape');
    return json
        .map((e) => fromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  static Map<String, dynamic> _obj(Object? json) {
    if (json is! Map<String, dynamic>) {
      throw const ApiError(200, 'Unexpected response shape');
    }
    return json;
  }

  static T? _maybeObj<T>(
      Object? json, T Function(Map<String, dynamic>) fromJson) {
    if (json == null) return null;
    return fromJson(_obj(json));
  }

  @override
  Future<StatusResponse> status() async {
    final res = await _send('GET', '/api/status');
    if (res.statusCode < 200 || res.statusCode >= 300) {
      _throw(res.statusCode, res.body);
    }
    await statusCache?.saveRaw(res.body);
    return StatusResponse.fromJson(
        jsonDecode(res.body) as Map<String, dynamic>);
  }

  @override
  Future<List<ChatMessage>> messages([int limit = 200]) => _get(
        '/api/messages',
        query: {'limit': '$limit'},
        parse: (json) => _list(json, ChatMessage.fromJson),
      );

  @override
  Future<void> sendMessage(String text) =>
      _mutate('POST', '/api/messages', body: {'text': text}, parse: (_) {});

  @override
  Future<void> runCycle() =>
      _mutate('POST', '/api/cycles', body: {}, parse: (_) {});

  @override
  Future<List<JournalEntry>> journal([int limit = 100]) => _get(
        '/api/journal',
        query: {'limit': '$limit'},
        parse: (json) => _list(json, JournalEntry.fromJson),
      );

  @override
  Future<List<OrderRecord>> orders([int limit = 100]) => _get(
        '/api/orders',
        query: {'limit': '$limit'},
        parse: (json) => _list(json, OrderRecord.fromJson),
      );

  @override
  Future<OrderRecord?> approve(String id) => _mutate(
        'POST',
        '/api/orders/${Uri.encodeComponent(id)}/approve',
        body: {},
        parse: (json) => _maybeObj(json, OrderRecord.fromJson),
      );

  @override
  Future<OrderRecord?> reject(String id, [String? reason]) => _mutate(
        'POST',
        '/api/orders/${Uri.encodeComponent(id)}/reject',
        body: reason == null || reason.trim().isEmpty
            ? {}
            : {'reason': reason},
        parse: (json) => _maybeObj(json, OrderRecord.fromJson),
      );

  @override
  Future<Settings> settings() => _get(
        '/api/settings',
        parse: (json) => Settings.fromJson(_obj(json)),
      );

  @override
  Future<Settings?> patchSettings(SettingsPatch patch) => _mutate(
        'PATCH',
        '/api/settings',
        body: patch.toJson(),
        parse: (json) => _maybeObj(json, Settings.fromJson),
      );

  @override
  Future<ConnectResponse> connectUrl() => _get(
        '/api/robinhood/connect',
        parse: (json) => ConnectResponse.fromJson(_obj(json)),
      );

  @override
  Future<void> disconnect() =>
      _mutate('POST', '/api/robinhood/disconnect', body: {}, parse: (_) {});

  @override
  Future<List<SubagentRun>> subagents() => _get(
        '/api/subagents',
        parse: (json) => _list(json, SubagentRun.fromJson),
      );

  @override
  Future<List<ChatMessage>> conversationMessages(String id,
          [int limit = 200]) =>
      _get(
        '/api/conversations/${Uri.encodeComponent(id)}/messages',
        query: {'limit': '$limit'},
        parse: (json) => _list(json, ChatMessage.fromJson),
      );

  @override
  Future<List<SkillSummary>> skills() => _get(
        '/api/skills',
        parse: (json) => _list(json, SkillSummary.fromJson),
      );

  @override
  Future<Skill> skill(String name) => _get(
        '/api/skills/${Uri.encodeComponent(name)}',
        parse: (json) => Skill.fromJson(_obj(json)),
      );

  @override
  Future<List<NoteFile>> notes() => _get(
        '/api/notes',
        parse: (json) => _list(json, NoteFile.fromJson),
      );

  @override
  Future<NoteContent> note(String path) {
    final encoded =
        path.split('/').map(Uri.encodeComponent).join('/');
    return _get(
      '/api/notes/$encoded',
      parse: (json) => NoteContent.fromJson(_obj(json)),
    );
  }

  @override
  Future<PriceHistory> history(String symbol, HistoryRange range) => _get(
        '/api/market/history',
        query: {
          'symbol': symbol,
          'range': historyRangeWire(range),
        },
        parse: (json) => PriceHistory.fromJson(_obj(json)),
      );

  @override
  Future<EquityHistory> equity(AnalyticsRange range) => _get(
        '/api/analytics/equity',
        query: {'range': analyticsRangeWire(range)},
        parse: (json) => EquityHistory.fromJson(_obj(json)),
      );

  @override
  Future<PerformanceSummary> performance() => _get(
        '/api/analytics/performance',
        parse: (json) => PerformanceSummary.fromJson(_obj(json)),
      );

  @override
  Future<List<ReportSummary>> reports({ReportKind? kind, int? limit}) {
    final query = <String, String>{};
    if (kind != null) query['kind'] = kind.name;
    if (limit != null) query['limit'] = '$limit';
    return _get(
      '/api/reports',
      query: query.isEmpty ? null : query,
      parse: (json) => _list(json, ReportSummary.fromJson),
    );
  }

  @override
  Future<Report> report(String id) => _get(
        '/api/reports/${Uri.encodeComponent(id)}',
        parse: (json) => Report.fromJson(_obj(json)),
      );

  @override
  Future<MarketOverview> marketOverview() => _get(
        '/api/market/overview',
        parse: (json) => MarketOverview.fromJson(_obj(json)),
      );

  @override
  Future<SymbolDetail> symbolDetail(String symbol) => _get(
        '/api/symbols/${Uri.encodeComponent(symbol)}',
        parse: (json) => SymbolDetail.fromJson(_obj(json)),
      );

  @override
  Future<List<SimRun>> simRuns() => _get(
        '/api/sim/runs',
        parse: (json) => _list(json, SimRun.fromJson),
      );

  @override
  Future<SimRun> simRun(String id) => _get(
        '/api/sim/runs/${Uri.encodeComponent(id)}',
        parse: (json) => SimRun.fromJson(_obj(json)),
      );

  @override
  Future<SimRun> simStart(SimRunConfig config) => _mutate(
        'POST',
        '/api/sim/runs',
        body: config.toJson(),
        parse: (json) => SimRun.fromJson(_obj(json)),
      );

  @override
  Future<SimRun?> simStop(String id) => _mutate(
        'POST',
        '/api/sim/runs/${Uri.encodeComponent(id)}/stop',
        body: {},
        parse: (json) => _maybeObj(json, SimRun.fromJson),
      );

  @override
  Future<List<SimScenario>> simScenarios() => _get(
        '/api/sim/scenarios',
        parse: (json) => _list(json, SimScenario.fromJson),
      );

  @override
  Future<List<SimSuite>> simSuites() => _get(
        '/api/sim/suites',
        parse: (json) => _list(json, SimSuite.fromJson),
      );

  @override
  Future<SimSuite> simSuite(String id) => _get(
        '/api/sim/suites/${Uri.encodeComponent(id)}',
        parse: (json) => SimSuite.fromJson(_obj(json)),
      );

  @override
  Future<SimSuite> simSuiteStart(SimSuiteConfig config) => _mutate(
        'POST',
        '/api/sim/suites',
        body: config.toJson(),
        parse: (json) => SimSuite.fromJson(_obj(json)),
      );

  @override
  Future<SimSuite?> simSuiteStop(String id) => _mutate(
        'POST',
        '/api/sim/suites/${Uri.encodeComponent(id)}/stop',
        body: {},
        parse: (json) => _maybeObj(json, SimSuite.fromJson),
      );

  @override
  Future<List<ChatMessage>> simMessages(String id,
      {int limit = 200, String? conversationId}) {
    final query = <String, String>{'limit': '$limit'};
    if (conversationId != null) query['conversationId'] = conversationId;
    return _get(
      '/api/sim/runs/${Uri.encodeComponent(id)}/messages',
      query: query,
      parse: (json) => _list(json, ChatMessage.fromJson),
    );
  }

  @override
  Future<List<JournalEntry>> simJournal(String id) => _get(
        '/api/sim/runs/${Uri.encodeComponent(id)}/journal',
        parse: (json) => _list(json, JournalEntry.fromJson),
      );

  @override
  Future<List<OrderRecord>> simOrders(String id) => _get(
        '/api/sim/runs/${Uri.encodeComponent(id)}/orders',
        parse: (json) => _list(json, OrderRecord.fromJson),
      );

  @override
  Future<PushTestResult> pushTest() => _mutate(
        'POST',
        '/api/push/test',
        body: {},
        parse: (json) => PushTestResult.fromJson(_obj(json)),
      );
}
