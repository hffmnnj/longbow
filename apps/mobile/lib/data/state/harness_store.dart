import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/format.dart' show etDayKey;
import 'package:longbow/models/models.dart';

import '../api/harness_api.dart';
import '../api/providers.dart';
import '../api/status_cache.dart';
import '../connection/server_locator.dart';
import 'clock.dart';
import 'feed_reducer.dart';
import 'preferences.dart';
import 'sim_store.dart';
import 'toast.dart';

/// Async resource with its own loading and error state. Mirrors the web
/// `Loadable`: stale data stays on screen while a refresh runs.
class Loadable<T> {
  const Loadable.loading([this.at])
      : state = LoadState.loading,
        data = null,
        error = null;

  const Loadable.ready(this.data, this.at)
      : state = LoadState.ready,
        error = null;

  const Loadable.error(this.error)
      : state = LoadState.error,
        data = null,
        at = null;

  const Loadable._(this.state, this.data, this.error, this.at);

  final LoadState state;
  final T? data;
  final String? error;

  /// When `data` was fetched; -1 marks an in-flight request.
  final int? at;

  Loadable<T> withError(String message) =>
      Loadable<T>._(state, data, message, at);
}

enum LoadState { loading, ready, error }

enum ConnectionStatus { connecting, live, offline }

/// Stale-while-revalidate window for the analytics endpoints (60 s, as web).
const int staleMs = 60000;

/// Seconds an optimistic outbox message lingers after the server commits it
/// before it is dropped (20 s, as web).
final outboxRetentionProvider =
    Provider<Duration>((_) => const Duration(seconds: 20));

class HarnessState {
  const HarnessState({
    this.feed = const FeedState(),
    this.connection = ConnectionStatus.connecting,
    this.loaded = false,
    this.loadError,
    this.busy = const {},
    this.cachedAt,
    this.skills = const [],
    this.history = const {},
    this.docs = const {},
    this.equity = const {},
    this.performance = const Loadable.loading(),
    this.reports = const Loadable.loading(),
    this.reportDetail = const {},
    this.market = const Loadable.loading(),
    this.symbolDetail = const {},
  });

  final FeedState feed;
  final ConnectionStatus connection;
  final bool loaded;
  final String? loadError;
  final Map<String, bool> busy;

  /// Set when the status came from the offline cache: the time that snapshot
  /// was saved. Cleared after a live status arrives.
  final int? cachedAt;

  final List<SkillSummary> skills;
  final Map<String, Loadable<PriceHistory>> history;
  final Map<String, Loadable<String>> docs;
  final Map<String, Loadable<EquityHistory>> equity;
  final Loadable<PerformanceSummary> performance;
  final Loadable<List<ReportSummary>> reports;
  final Map<String, Loadable<Report>> reportDetail;
  final Loadable<MarketOverview> market;
  final Map<String, Loadable<SymbolDetail>> symbolDetail;

  HarnessState copyWith({
    FeedState? feed,
    ConnectionStatus? connection,
    bool? loaded,
    String? Function()? loadError,
    Map<String, bool>? busy,
    int? Function()? cachedAt,
    List<SkillSummary>? skills,
    Map<String, Loadable<PriceHistory>>? history,
    Map<String, Loadable<String>>? docs,
    Map<String, Loadable<EquityHistory>>? equity,
    Loadable<PerformanceSummary>? performance,
    Loadable<List<ReportSummary>>? reports,
    Map<String, Loadable<Report>>? reportDetail,
    Loadable<MarketOverview>? market,
    Map<String, Loadable<SymbolDetail>>? symbolDetail,
  }) {
    return HarnessState(
      feed: feed ?? this.feed,
      connection: connection ?? this.connection,
      loaded: loaded ?? this.loaded,
      loadError: loadError != null ? loadError() : this.loadError,
      busy: busy ?? this.busy,
      cachedAt: cachedAt != null ? cachedAt() : this.cachedAt,
      skills: skills ?? this.skills,
      history: history ?? this.history,
      docs: docs ?? this.docs,
      equity: equity ?? this.equity,
      performance: performance ?? this.performance,
      reports: reports ?? this.reports,
      reportDetail: reportDetail ?? this.reportDetail,
      market: market ?? this.market,
      symbolDetail: symbolDetail ?? this.symbolDetail,
    );
  }
}

/// Toast copy for a newly published report. Mirrors `reportToast` in
/// apps/web/src/lib/reports.ts.
({String title, String body}) reportToast(ReportSummary report) {
  if (report.kind == ReportKind.daily) {
    return (title: 'Daily report ready', body: report.headline);
  }
  if (report.kind == ReportKind.weekly) {
    return (title: 'Weekly report ready', body: report.headline);
  }
  return (
    title: 'Trade report · ${report.symbol ?? 'closed position'}',
    body: report.headline
  );
}

String _message(Object? error) {
  if (error is ApiError) return error.message;
  if (error is Error) {
    // Error.toString prefixes the message with its kind ("Bad state: ...").
    return error.toString().replaceFirst(RegExp(r'^[^:]+: '), '');
  }
  return 'Something went wrong';
}

/// Dart port of apps/web/src/lib/store.svelte.ts: the live account feed, the
/// event stream, and every REST action screens use.
///
/// The store gets its API through [harnessApiProvider] (null until the
/// locator connects) and starts its event stream when the API becomes
/// available. Server-sent events fold into [HarnessState.feed] via the pure
/// [applyEvent] reducer; sim events route to the sim store, exactly as web.
class HarnessStore extends Notifier<HarnessState> {
  HarnessApi? _api;
  EventFeedHandle? _handle;
  int _outSeq = 0;
  final List<Timer> _timers = [];

  ToastQueue get _toasts => ref.read(toastQueueProvider);

  @override
  HarnessState build() {
    final prefs = ref.watch(sharedPreferencesProvider);
    var initial = const HarnessState();
    final cached = StatusCache(prefs).load();
    if (cached != null) {
      final cachedStatus = cached.status;
      initial = initial.copyWith(
        feed: initial.feed.copyWith(status: () => cachedStatus),
        cachedAt: () => cached.at,
      );
    }
    ref.listen<HarnessApi?>(harnessApiProvider, (previous, next) {
      if (identical(previous, next)) return;
      // Deferred past build: attaching touches the event loop.
      unawaited(Future.microtask(() {
        if (next == null) {
          _detach();
        } else {
          _attach(next);
          unawaited(refresh());
        }
      }));
    }, fireImmediately: true);
    ref.onDispose(() {
      for (final timer in _timers) {
        timer.cancel();
      }
      _timers.clear();
      _detach();
    });
    return initial;
  }

  void _update(HarnessState next) {
    if (!ref.mounted) return;
    state = next;
  }

  void _attach(HarnessApi api) {
    if (identical(_api, api) && _handle != null) return;
    _detach();
    _api = api;
    _handle = ref.read(eventStreamFactoryProvider)(
      api.baseUrl,
      onEvent: _onEvent,
      onOpen: _onOpen,
      onClose: _onClose,
    );
  }

  void _detach() {
    _handle?.dispose();
    _handle = null;
    _api = null;
  }

  /// Attaches to the current API (if any) and refreshes. Called once by the
  /// shell at launch; the store otherwise reacts to the API provider.
  Future<void> start() async {
    final api = ref.read(harnessApiProvider);
    if (api != null) _attach(api);
    await refresh();
  }

  void stop() {
    _detach();
  }

  void _onEvent(ServerEvent event) {
    if (event is SimEvent ||
        event is SimSuiteEvent ||
        simRunIdOf(event) != null) {
      ref.read(simProvider.notifier).apply(event);
      return;
    }
    _update(state.copyWith(feed: applyEvent(state.feed, event)));
    if (event is NoteEvent) _noteChanged(event.note);
    if (event is ReportEvent) _reportArrived(event.report);
  }

  void _onOpen() {
    final wasOffline = state.connection == ConnectionStatus.offline;
    _update(state.copyWith(connection: ConnectionStatus.live));
    ref.read(serverLocatorProvider.notifier).notifyStreamOpen();
    if (wasOffline || !state.loaded) unawaited(refresh());
  }

  void _onClose() {
    _update(state.copyWith(connection: ConnectionStatus.offline));
    unawaited(
        ref.read(serverLocatorProvider.notifier).notifyStreamClosed());
  }

  void _noteChanged(NoteFile note) {
    if (state.docs.containsKey('note:${note.path}')) {
      unawaited(loadDoc('note', note.path, true));
    }
  }

  /// A published report slides to the top of the list; the toast opens it.
  void _reportArrived(ReportSummary report) {
    final toast = reportToast(report);
    _toasts.add(ToastEvent(
      tone: ToastTone.success,
      title: toast.title,
      body: toast.body,
      actionLabel: 'Open',
      reportId: report.id,
    ));
  }

  Future<T?> _settled<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } catch (_) {
      return null;
    }
  }

  Future<void> refresh() async {
    final api = _api;
    if (api == null) return;
    // Status first and on its own: an offline launch still shows the last
    // known equity. Each fetch settles independently, like Promise.allSettled.
    final feed = state.feed;
    StatusResponse? status;
    List<ChatMessage>? messages;
    List<JournalEntry>? journal;
    List<OrderRecord>? orders;
    Object? firstError;
    try {
      status = await api.status();
    } catch (e) {
      firstError ??= e;
    }
    try {
      messages = await api.messages(200);
    } catch (e) {
      firstError ??= e;
    }
    try {
      journal = await api.journal(100);
    } catch (e) {
      firstError ??= e;
    }
    try {
      orders = await api.orders(100);
    } catch (e) {
      firstError ??= e;
    }
    StatusResponse? Function()? statusFn;
    // A final local stays promoted inside the closure.
    final liveStatus = status;
    if (liveStatus != null) statusFn = () => liveStatus;
    _update(state.copyWith(
      feed: feed.copyWith(
        status: statusFn,
        messages: messages ?? feed.messages,
        journal: journal ?? feed.journal,
        orders: orders ?? feed.orders,
      ),
      cachedAt: status != null ? () => null : null,
      loadError: () =>
          firstError == null ? null : _message(firstError),
      loaded: true,
    ));
    if (firstError == null) unawaited(_refreshExtras(api));
    unawaited(ref.read(simProvider.notifier).loadRuns());
  }

  /// Subagents, notes and skills fail soft: the feed works without them.
  Future<void> _refreshExtras(HarnessApi api) async {
    final runs = await _settled(api.subagents);
    final notes = await _settled(api.notes);
    final skills = await _settled(api.skills);
    var subagents = state.feed.subagents;
    var noteFiles = state.feed.notes;
    if (runs != null) {
      final byId = {for (final r in runs) r.id: r};
      for (final r in subagents) {
        byId.putIfAbsent(r.id, () => r);
      }
      subagents = byId.values.toList()
        ..sort((a, b) => b.startedAt.compareTo(a.startedAt));
    }
    if (notes != null) {
      noteFiles = List<NoteFile>.of(notes)
        ..sort((a, b) => a.path.compareTo(b.path));
    }
    _update(state.copyWith(
      feed: state.feed.copyWith(subagents: subagents, notes: noteFiles),
      skills: skills ?? state.skills,
    ));
  }

  Future<void> loadHistory(String symbol, HistoryRange range) async {
    final api = _api;
    if (api == null) return;
    final key = '$symbol:${historyRangeWire(range)}';
    if (state.history.containsKey(key)) return;
    _update(state.copyWith(
        history: {...state.history, key: const Loadable.loading()}));
    try {
      final data = await api.history(symbol, range);
      _update(state.copyWith(history: {
        ...state.history,
        key: Loadable.ready(data, DateTime.now().millisecondsSinceEpoch),
      }));
    } catch (e) {
      _update(state.copyWith(history: {
        ...state.history,
        key: Loadable.error(_message(e)),
      }));
    }
  }

  void retryHistory(String symbol, HistoryRange range) {
    final next = Map<String, Loadable<PriceHistory>>.of(state.history)
      ..remove('$symbol:${historyRangeWire(range)}');
    _update(state.copyWith(history: next));
    unawaited(loadHistory(symbol, range));
  }

  /// Shared stale-while-revalidate loader for the analytics endpoints.
  Future<void> _load<T>(
    Loadable<T>? Function(HarnessState current) read,
    HarnessState Function(HarnessState current, Loadable<T> value) write,
    Future<T> Function(HarnessApi api) fetch, {
    bool force = false,
  }) async {
    final api = _api;
    if (api == null) return;
    final current = read(state);
    final now = DateTime.now().millisecondsSinceEpoch;
    if (!force &&
        current != null &&
        current.state == LoadState.ready &&
        current.at != null &&
        now - current.at! < staleMs) {
      return;
    }
    if (current != null &&
        current.state == LoadState.loading &&
        current.data == null &&
        current.at == -1) {
      return;
    }
    if (current == null || current.data == null) {
      _update(write(state, const Loadable.loading(-1)));
    }
    try {
      final data = await fetch(api);
      _update(write(
          state, Loadable.ready(data, DateTime.now().millisecondsSinceEpoch)));
    } catch (e) {
      final message = _message(e);
      _update(write(
          state,
          current != null && current.data != null
              ? current.withError(message)
              : Loadable.error(message)));
    }
  }

  Future<void> loadEquity(AnalyticsRange range, {bool force = false}) =>
      _load<EquityHistory>(
        (s) => s.equity[analyticsRangeWire(range)],
        (s, v) => s.copyWith(equity: {...s.equity, analyticsRangeWire(range): v}),
        (api) => api.equity(range),
        force: force,
      );

  Future<void> loadPerformance({bool force = false}) => _load<PerformanceSummary>(
        (s) => s.performance,
        (s, v) => s.copyWith(performance: v),
        (api) => api.performance(),
        force: force,
      );

  Future<void> loadReports({bool force = false}) =>
      _load<List<ReportSummary>>(
        (s) => s.reports,
        (s, v) => s.copyWith(reports: v),
        (api) => api.reports(),
        force: force,
      );

  Future<void> loadReport(String id, {bool force = false}) =>
      _load<Report>(
        (s) => s.reportDetail[id],
        (s, v) => s.copyWith(reportDetail: {...s.reportDetail, id: v}),
        (api) => api.report(id),
        force: force,
      );

  Future<void> loadMarket({bool force = false}) => _load<MarketOverview>(
        (s) => s.market,
        (s, v) => s.copyWith(market: v),
        (api) => api.marketOverview(),
        force: force,
      );

  Future<void> loadSymbolDetail(String symbol, {bool force = false}) =>
      _load<SymbolDetail>(
        (s) => s.symbolDetail[symbol],
        (s, v) => s.copyWith(symbolDetail: {...s.symbolDetail, symbol: v}),
        (api) => api.symbolDetail(symbol),
        force: force,
      );

  /// Markdown for a note or skill. `force` refetches without flashing the
  /// old text away.
  Future<void> loadDoc(String kind, String id, [bool force = false]) async {
    final api = _api;
    if (api == null) return;
    final key = '$kind:$id';
    final current = state.docs[key];
    if (current != null && !force && current.state != LoadState.error) return;
    if (current == null || current.state == LoadState.error) {
      _update(
          state.copyWith(docs: {...state.docs, key: const Loadable.loading()}));
    }
    try {
      final text = kind == 'note'
          ? (await api.note(id)).content
          : (await api.skill(id)).body;
      _update(state.copyWith(docs: {...state.docs, key: Loadable.ready(text, DateTime.now().millisecondsSinceEpoch)}));
    } catch (e) {
      _update(state.copyWith(docs: {
        ...state.docs,
        key: Loadable.error(_message(e)),
      }));
    }
  }

  Future<void> loadTranscript(String id) async {
    final api = _api;
    if (api == null) return;
    try {
      final fetched = await api.conversationMessages(id, 200);
      _update(state.copyWith(feed: mergeTranscript(state.feed, id, fetched)));
    } catch (e) {
      _toasts.add(ToastEvent(
        tone: ToastTone.error,
        title: 'Could not load the agent transcript',
        body: _message(e),
      ));
    }
  }

  Future<T?> _run<T>(
      String key, Future<T> Function(HarnessApi api) fn, String? fail) async {
    final api = _api;
    if (api == null || (state.busy[key] ?? false)) return null;
    _update(state.copyWith(busy: {...state.busy, key: true}));
    try {
      return await fn(api);
    } catch (e) {
      final message = _message(e);
      _toasts.add(ToastEvent(
        tone: ToastTone.error,
        title: fail ?? message,
        body: fail != null ? message : '',
      ));
      return null;
    } finally {
      _update(state.copyWith(busy: {...state.busy, key: false}));
    }
  }

  Future<void> runCycle() async {
    final ok = await _run(
        'cycle', (api) => api.runCycle().then((_) => true), 'Could not start a cycle');
    if (ok == true) {
      _toasts.add(const ToastEvent(
          tone: ToastTone.success, title: 'Cycle requested'));
    }
  }

  /// Shows the message at once; the committed message from the server
  /// replaces it. Pass [retryId] to retry a failed outbox entry.
  Future<void> send(String text, {String? retryId}) async {
    if (retryId != null) {
      _update(state.copyWith(feed: dropOutbox(state.feed, retryId)));
    }
    _outSeq++;
    final id = 'out-$_outSeq';
    _update(state.copyWith(
        feed: addOutbox(state.feed,
            OutboxItem(id: id, text: text, at: DateTime.now().millisecondsSinceEpoch))));
    final ok = await _run(
        'send:$id', (api) => api.sendMessage(text).then((_) => true), null);
    if (ok == true) {
      final retention = ref.read(outboxRetentionProvider);
      final timer = Timer(retention, () {
        _update(state.copyWith(feed: dropOutbox(state.feed, id)));
      });
      _timers.add(timer);
    } else {
      _update(state.copyWith(feed: failOutbox(state.feed, id)));
    }
  }

  void discardOutbox(String id) {
    _update(state.copyWith(feed: dropOutbox(state.feed, id)));
  }

  Future<void> approve(String id) async {
    await _run('order:$id', (api) => api.approve(id),
        'Could not approve the order');
  }

  Future<void> reject(String id, [String? reason]) async {
    await _run('order:$id', (api) => api.reject(id, reason?.trim()),
        'Could not reject the order');
  }

  /// Throws [ApiError] so the settings form can place field errors inline.
  Future<void> patchSettings(SettingsPatch patch) async {
    final api = _api;
    if (api == null) throw StateError('Not connected');
    await api.patchSettings(patch);
    await refreshStatus();
  }

  Future<bool> quickPatch(String key, SettingsPatch patch,
      [String? done]) async {
    final ok = await _run(key, (api) async {
      await api.patchSettings(patch);
      return true;
    }, 'Could not update settings');
    if (ok == true) {
      await refreshStatus();
      if (done != null) {
        _toasts.add(ToastEvent(tone: ToastTone.success, title: done));
      }
    }
    return ok == true;
  }

  Future<void> refreshStatus() async {
    final api = _api;
    if (api == null) return;
    try {
      final status = await api.status();
      _update(state.copyWith(
        feed: state.feed.copyWith(status: () => status),
        cachedAt: () => null,
      ));
    } catch (_) {
      // The event stream catches up.
    }
  }

  /// Returns the Robinhood sign-in URL for the UI to launch, or null when
  /// sign-in could not start.
  Future<String?> connectRobinhood() async {
    final response = await _run(
        'connect', (api) => api.connectUrl(), 'Could not start Robinhood sign-in');
    return response?.url;
  }

  Future<void> disconnectRobinhood() async {
    final ok = await _run('disconnect',
        (api) => api.disconnect().then((_) => true), 'Could not disconnect');
    if (ok == true) {
      await refreshStatus();
      _toasts.add(const ToastEvent(
          tone: ToastTone.info, title: 'Robinhood disconnected'));
    }
  }
}

final harnessProvider =
    NotifierProvider<HarnessStore, HarnessState>(HarnessStore.new);

/// Orders waiting for a human decision.
final pendingOrdersProvider = Provider<List<OrderRecord>>((ref) {
  final orders = ref.watch(harnessProvider.select((s) => s.feed.orders));
  return orders
      .where((o) => o.status == OrderStatus.pendingApproval)
      .toList(growable: false);
});

/// Halts plus orders that failed today (device-local day): the number on the
/// Home Screen badge. Ticks with the clock so midnight flips it.
final alertsCountProvider = Provider<int>((ref) {
  ref.watch(clockProvider);
  final feed = ref.watch(harnessProvider.select((s) => s.feed));
  final halts = feed.status?.halts.length ?? 0;
  final today = etDayKey(DateTime.now().millisecondsSinceEpoch);
  final failed = feed.orders
      .where((o) =>
          o.status == OrderStatus.failed &&
          etDayKey(o.createdAt) == today)
      .length;
  return halts + failed;
});

final positionsProvider = Provider<List<Position>>((ref) =>
    ref.watch(harnessProvider.select((s) => s.feed.status))?.account?.positions ?? const []);

final agentRunningProvider = Provider<bool>((ref) =>
    ref.watch(harnessProvider.select((s) => s.feed.status))?.agent.state ==
    AgentState.running);

/// Tickers worth making clickable: held, watched, or seen in orders and the
/// journal.
final knownSymbolsProvider = Provider<Set<String>>((ref) {
  final feed = ref.watch(harnessProvider.select((s) => s.feed));
  return {
    ...feed.status?.settings.watchlist ?? const [],
    ...feed.status?.account?.positions.map((p) => p.symbol) ?? const [],
    ...feed.orders.map((o) => o.intent.symbol),
    ...feed.journal
        .map((j) => j.symbol)
        .where((symbol) => symbol != null)
        .cast<String>(),
  };
});

/// Newest published report, for the Portfolio card and the list.
final latestReportProvider = Provider<ReportSummary?>((ref) {
  final data = ref.watch(harnessProvider.select((s) => s.reports)).data;
  if (data == null || data.isEmpty) return null;
  return data.first;
});
