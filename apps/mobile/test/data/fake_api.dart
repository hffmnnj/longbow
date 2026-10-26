import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/api/harness_api.dart';
import 'package:longbow/data/api/providers.dart';
import 'package:longbow/data/state/harness_store.dart';
import 'package:longbow/data/state/preferences.dart';
import 'package:longbow/data/state/sim_store.dart';
import 'package:longbow/data/state/toast.dart';
import 'package:longbow/models/models.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'model_builders.dart';

/// A [HarnessApi] whose responses are scripted per method name. Tests hold it
/// as [HarnessApi] so every call is statically checked; unscripted calls
/// throw [UnimplementedError] instead of silently returning nulls.
class FakeApi implements HarnessApi {
  FakeApi({Uri? baseUrl})
      : baseUrl = baseUrl ?? Uri.parse('https://longbow.example.ts.net:8443');

  @override
  final Uri baseUrl;

  final Map<String, dynamic Function(Invocation invocation)> handlers = {};
  final List<String> calls = [];

  /// Handlers keep their natural (unannotated) closure types: wrapping them
  /// in a typed `Future<Object?>` would fail the reified return-type check
  /// at the statically typed call site.
  void on(String method, dynamic Function() handler) {
    handlers[method] = (_) => handler();
  }

  void fail(String method, Object error) {
    // An async closure that only throws has type Future<Never>, which is a
    // subtype of every Future<T> the statically typed call sites expect.
    handlers[method] = (_) async {
      throw error;
    };
  }

  /// Default responses for a full refresh plus the soft extras.
  void defaults() {
    on('status', () async => testStatus());
    on('messages', () async => <ChatMessage>[]);
    on('journal', () async => <JournalEntry>[]);
    on('orders', () async => <OrderRecord>[]);
    on('subagents', () async => <SubagentRun>[]);
    on('notes', () async => <NoteFile>[]);
    on('skills', () async => <SkillSummary>[]);
    on('simRuns', () async => <SimRun>[]);
    on('simSuites', () async => <SimSuite>[]);
  }

  int count(String method) =>
      calls.where((call) => call == method).length;

  static String _name(Invocation invocation) {
    final text = invocation.memberName.toString();
    final match = RegExp(r'"([^"]+)"').firstMatch(text);
    return match?.group(1) ?? text;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) {
    final name = _name(invocation);
    if (invocation.isGetter) throw UnimplementedError('FakeApi.$name');
    calls.add(name);
    final handler = handlers[name];
    if (handler != null) return handler(invocation);
    throw UnimplementedError('FakeApi.$name');
  }
}

/// Captures the harness store's event subscription so tests drive the stream
/// by hand.
class FakeEvents {
  late Uri baseUrl;
  late void Function(ServerEvent event) onEvent;
  late void Function() onOpen;
  late void Function() onClose;
  final List<FakeFeedHandle> handles = [];

  EventFeedHandle factory(
    Uri url, {
    required void Function(ServerEvent event) onEvent,
    required void Function() onOpen,
    required void Function() onClose,
  }) {
    baseUrl = url;
    this.onEvent = onEvent;
    this.onOpen = onOpen;
    this.onClose = onClose;
    final handle = FakeFeedHandle();
    handles.add(handle);
    return handle;
  }
}

class FakeFeedHandle implements EventFeedHandle {
  bool disposed = false;

  @override
  void dispose() {
    disposed = true;
  }
}

/// A ProviderContainer with the data layer wired to fakes, mirroring how the
/// shell holds providers active with real subscriptions.
class StoreHarness {
  StoreHarness._();

  static Future<StoreHarness> create({
    Map<String, Object> prefs = const {},
    FakeApi? api,
    Duration outboxRetention = Duration.zero,
  }) async {
    // The harness notifies the real server locator on stream open/close;
    // host-less it settles on NoHosts with no network. It still needs a
    // Flutter binding for the platform channels it touches.
    TestWidgetsFlutterBinding.ensureInitialized();
    SharedPreferences.setMockInitialValues(prefs);
    final shared = await SharedPreferences.getInstance();
    final fakeApi = api ?? (FakeApi()..defaults());
    final events = FakeEvents();
    final toasts = <ToastEvent>[];
    final container = ProviderContainer(overrides: [
      sharedPreferencesProvider.overrideWithValue(shared),
      harnessApiProvider.overrideWithValue(fakeApi),
      eventStreamFactoryProvider.overrideWithValue(events.factory),
      outboxRetentionProvider.overrideWithValue(outboxRetention),
    ]);
    // The shell watches these; without a listener Riverpod pauses them.
    container.listen<HarnessState>(harnessProvider, (_, _) {});
    container.listen<SimState>(simProvider, (_, _) {});
    container.listen<AsyncValue<ToastEvent>>(
        toastEventsProvider, (_, next) => next.whenData(toasts.add));
    final h = StoreHarness._()
      ..container = container
      ..api = fakeApi
      ..events = events
      ..toasts = toasts
      ..shared = shared;
    return h;
  }

  late ProviderContainer container;
  late FakeApi api;
  late FakeEvents events;
  late List<ToastEvent> toasts;
  late SharedPreferences shared;

  HarnessState get state => container.read(harnessProvider);
  HarnessStore get notifier => container.read(harnessProvider.notifier);
  SimState get sim => container.read(simProvider);
  SimStore get simStore => container.read(simProvider.notifier);

  /// Reads the provider (attaching the fake stream on first read) and lets
  /// the microtask attach plus the initial refresh settle.
  Future<void> start() async {
    container.read(harnessProvider);
    await pump();
    await pump();
  }

  Future<void> pump([int rounds = 30]) async {
    for (var i = 0; i < rounds; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  void dispose() => container.dispose();
}
