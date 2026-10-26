import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/models/models.dart';

import '../api/harness_api.dart';
import '../api/providers.dart';
import 'feed_reducer.dart';
import 'toast.dart';

/// Lab data: paper runs and the per-run agent feeds. Fed by the SSE stream
/// (routed here by the harness store) and the sim REST routes. Dart port of
/// apps/web/src/lib/sim.svelte.ts plus the reducer-dependent functions of
/// sim.ts (`emptySim`, `upsertSimRun`, `upsertSuite`, `applySimEvent`).
/// Strategy math (titles, metrics, comparisons) lives in
/// lib/domain/sim_calc.dart, owned by another worker.
class SimState {
  const SimState({
    this.runs = const [],
    this.suites = const [],
    this.feeds = const {},
    this.loaded = false,
    this.loadError,
    this.starting = false,
    this.startingSuite = false,
    this.scenarios = const [],
    this.scenariosLoaded = false,
    this.feedLoaded = const {},
  });

  /// Newest first.
  final List<SimRun> runs;

  /// Suites, newest first.
  final List<SimSuite> suites;

  /// One live-style feed per run: messages, journal, orders, subagents,
  /// transcripts.
  final Map<String, FeedState> feeds;
  final bool loaded;
  final String? loadError;
  final bool starting;
  final bool startingSuite;
  final List<SimScenario> scenarios;
  final bool scenariosLoaded;

  /// Run ids whose feed (messages, journal, orders) has been fetched.
  final Map<String, bool> feedLoaded;

  SimState copyWith({
    List<SimRun>? runs,
    List<SimSuite>? suites,
    Map<String, FeedState>? feeds,
    bool? loaded,
    String? Function()? loadError,
    bool? starting,
    bool? startingSuite,
    List<SimScenario>? scenarios,
    bool? scenariosLoaded,
    Map<String, bool>? feedLoaded,
  }) {
    return SimState(
      runs: runs ?? this.runs,
      suites: suites ?? this.suites,
      feeds: feeds ?? this.feeds,
      loaded: loaded ?? this.loaded,
      loadError: loadError != null ? loadError() : this.loadError,
      starting: starting ?? this.starting,
      startingSuite: startingSuite ?? this.startingSuite,
      scenarios: scenarios ?? this.scenarios,
      scenariosLoaded: scenariosLoaded ?? this.scenariosLoaded,
      feedLoaded: feedLoaded ?? this.feedLoaded,
    );
  }
}

SimState emptySim() => const SimState();

List<SimRun> upsertSimRun(List<SimRun> runs, SimRun run) {
  final next = runs.where((r) => r.id != run.id).toList()..add(run);
  next.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return next;
}

List<SimSuite> upsertSuite(List<SimSuite> suites, SimSuite suite) {
  final next = suites.where((s) => s.id != suite.id).toList()..add(suite);
  next.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return next;
}

/// The same event without its sim routing, for the run's own feed.
ServerEvent _unstripSim(ServerEvent event) => switch (event) {
      MessageEvent(:final message, :final conversationId) =>
        MessageEvent(message, conversationId: conversationId),
      DeltaEvent(:final text, :final conversationId) =>
        DeltaEvent(text, conversationId: conversationId),
      CallsEvent(:final calls, :final conversationId) =>
        CallsEvent(calls, conversationId: conversationId),
      SubagentEvent(:final run) => SubagentEvent(run),
      JournalEvent(:final entry) => JournalEvent(entry),
      OrderEvent(:final order) => OrderEvent(order),
      NoteEvent(:final note) => NoteEvent(note),
      ReportEvent(:final report) => ReportEvent(report),
      _ => event,
    };

/// Pure reducer: `sim` events upsert runs, `sim_suite` events upsert suites;
/// events with a `simRunId` feed that run's own [FeedState].
SimState applySimEvent(SimState state, ServerEvent event) {
  if (event is SimEvent) {
    return state.copyWith(runs: upsertSimRun(state.runs, event.run));
  }
  if (event is SimSuiteEvent) {
    return state.copyWith(suites: upsertSuite(state.suites, event.suite));
  }
  final simRunId = simRunIdOf(event);
  if (simRunId == null) return state;
  return state.copyWith(feeds: {
    ...state.feeds,
    simRunId: applyEvent(
        state.feeds[simRunId] ?? emptyState(), _unstripSim(event)),
  });
}

String _message(Object? error) => error is ApiError
    ? error.message
    : error is Error
        ? error.toString().replaceFirst(RegExp(r'^[^:]+: '), '')
        : 'Something went wrong';

class SimStore extends Notifier<SimState> {
  ToastQueue get _toasts => ref.read(toastQueueProvider);

  @override
  SimState build() {
    // The harness store routes events here; a null API (disconnected)
    // clears the lab, like the web's attach(null).
    ref.listen<HarnessApi?>(harnessApiProvider, (previous, next) {
      if (identical(previous, next)) return;
      if (next == null) {
        if (!ref.mounted) return;
        state = emptySim();
      }
    });
    return emptySim();
  }

  void _update(SimState next) {
    if (!ref.mounted) return;
    state = next;
  }

  void apply(ServerEvent event) {
    _update(applySimEvent(state, event));
  }

  SimRun? run(String? id) {
    if (id == null) return null;
    for (final run in state.runs) {
      if (run.id == id) return run;
    }
    return null;
  }

  SimSuite? suite(String? id) {
    if (id == null) return null;
    for (final suite in state.suites) {
      if (suite.id == id) return suite;
    }
    return null;
  }

  FeedState feed(String id) => state.feeds[id] ?? emptyState();

  Future<void> loadRuns() async {
    final api = ref.read(harnessApiProvider);
    if (api == null) return;
    try {
      List<SimSuite> fetchedSuites;
      try {
        fetchedSuites = await api.simSuites();
      } catch (_) {
        fetchedSuites = [];
      }
      final fetched = await api.simRuns();
      var runs = state.runs;
      // Events that arrived during the fetch are at least as new as the list.
      final live = {for (final r in runs) r.id: r};
      runs = fetched.map((r) => live[r.id] ?? r).toList();
      for (final r in live.values) {
        if (!runs.any((x) => x.id == r.id)) runs = upsertSimRun(runs, r);
      }
      var suites = fetchedSuites;
      final liveSuites = {for (final s in state.suites) s.id: s};
      for (final s in liveSuites.values) {
        if (!suites.any((x) => x.id == s.id)) suites = upsertSuite(suites, s);
      }
      _update(state.copyWith(
        runs: runs..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
        suites: suites,
        loadError: () => null,
        loaded: true,
      ));
    } catch (e) {
      _update(state.copyWith(
        loadError: () => _message(e),
        loaded: true,
      ));
    }
  }

  /// Scenario library for the new-run and new-suite sheets; fails soft to a
  /// Custom-dates form.
  Future<void> loadScenarios() async {
    final api = ref.read(harnessApiProvider);
    if (api == null || state.scenariosLoaded) return;
    try {
      _update(state.copyWith(
          scenarios: await api.simScenarios(), scenariosLoaded: true));
    } catch (_) {
      _update(state.copyWith(scenarios: const [], scenariosLoaded: true));
    }
  }

  /// Fetch a run's agent feed once; streamed events keep it current
  /// afterwards.
  Future<void> loadFeed(String id, [bool force = false]) async {
    final api = ref.read(harnessApiProvider);
    if (api == null || ((state.feedLoaded[id] ?? false) && !force)) return;
    _update(state.copyWith(feedLoaded: {...state.feedLoaded, id: true}));
    final messages = await _settled(() => api.simMessages(id, limit: 200));
    final journal = await _settled(() => api.simJournal(id));
    final orders = await _settled(() => api.simOrders(id));
    var feed = this.feed(id);
    if (messages != null) {
      for (final m in messages) {
        feed = feed.copyWith(messages: upsertMessage(feed.messages, m));
      }
    }
    if (journal != null) {
      for (final e in journal) {
        feed = feed.copyWith(journal: upsertJournal(feed.journal, e));
      }
    }
    if (orders != null) {
      for (final o in orders) {
        feed = feed.copyWith(orders: upsertOrder(feed.orders, o));
      }
    }
    _update(state.copyWith(feeds: {...state.feeds, id: feed}));
    if (messages == null && journal == null && orders == null) {
      _update(state.copyWith(
          feedLoaded: {...state.feedLoaded, id: false}));
    }
  }

  Future<T?> _settled<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } catch (_) {
      return null;
    }
  }

  Future<void> loadTranscript(String runId, String conversationId) async {
    final api = ref.read(harnessApiProvider);
    if (api == null) return;
    try {
      final fetched = await api.simMessages(runId,
          limit: 200, conversationId: conversationId);
      final feed = mergeTranscript(this.feed(runId), conversationId, fetched);
      _update(state.copyWith(feeds: {...state.feeds, runId: feed}));
    } catch (e) {
      _toasts.add(ToastEvent(
        tone: ToastTone.error,
        title: 'Could not load the agent transcript',
        body: _message(e),
      ));
    }
  }

  /// Returns the new run, or the server's message when it refuses the config.
  Future<({SimRun? run, String? error})> start(SimRunConfig config) async {
    final api = ref.read(harnessApiProvider);
    if (api == null) return (run: null, error: 'Not connected');
    _update(state.copyWith(starting: true));
    try {
      final run = await api.simStart(config);
      _update(state.copyWith(
        runs: upsertSimRun(state.runs, run),
        starting: false,
      ));
      return (run: run, error: null);
    } catch (e) {
      _update(state.copyWith(starting: false));
      return (run: null, error: _message(e));
    }
  }

  Future<void> stop(String id) async {
    final api = ref.read(harnessApiProvider);
    if (api == null) return;
    try {
      final run = await api.simStop(id);
      if (run != null) {
        _update(state.copyWith(runs: upsertSimRun(state.runs, run)));
      }
      _toasts.add(const ToastEvent(
          tone: ToastTone.info, title: 'Stopping simulation'));
    } catch (e) {
      _toasts.add(ToastEvent(
        tone: ToastTone.error,
        title: 'Could not stop the run',
        body: _message(e),
      ));
    }
  }

  /// Returns the new suite, or the server's message when it refuses the
  /// config.
  Future<({SimSuite? suite, String? error})> startSuite(
      SimSuiteConfig config) async {
    final api = ref.read(harnessApiProvider);
    if (api == null) return (suite: null, error: 'Not connected');
    _update(state.copyWith(startingSuite: true));
    try {
      final suite = await api.simSuiteStart(config);
      _update(state.copyWith(
        suites: upsertSuite(state.suites, suite),
        startingSuite: false,
      ));
      return (suite: suite, error: null);
    } catch (e) {
      _update(state.copyWith(startingSuite: false));
      return (suite: null, error: _message(e));
    }
  }

  Future<void> stopSuite(String id) async {
    final api = ref.read(harnessApiProvider);
    if (api == null) return;
    try {
      final suite = await api.simSuiteStop(id);
      if (suite != null) {
        _update(state.copyWith(suites: upsertSuite(state.suites, suite)));
      }
      _toasts.add(const ToastEvent(
          tone: ToastTone.info, title: 'Stopping suite'));
    } catch (e) {
      _toasts.add(ToastEvent(
        tone: ToastTone.error,
        title: 'Could not stop the suite',
        body: _message(e),
      ));
    }
  }
}

final simProvider = NotifierProvider<SimStore, SimState>(SimStore.new);

/// One run's agent feed, or an empty feed before it loads.
final simFeedProvider = Provider.family<FeedState, String>(
    (ref, id) => ref.watch(simProvider.select((s) => s.feeds))[id] ?? emptyState());

/// One run by id, or null.
final simRunProvider = Provider.family<SimRun?, String>(
    (ref, id) => ref.watch(simProvider.notifier).run(id));

/// Run ids ticked for the compare view.
class CompareSelection extends Notifier<Set<String>> {
  @override
  Set<String> build() => const {};

  void toggle(String id) {
    final next = Set<String>.of(state);
    if (!next.remove(id)) next.add(id);
    state = next;
  }

  void clear() {
    state = const {};
  }
}

final simCompareProvider =
    NotifierProvider<CompareSelection, Set<String>>(CompareSelection.new);
