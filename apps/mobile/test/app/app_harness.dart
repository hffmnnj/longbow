import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/app/shell_tabs.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:shared_preferences/shared_preferences.dart';

import '../support/pump_screen.dart';

export '../support/pump_screen.dart';

/// Native channel stand-in: scripted notification state, Tailscale result and
/// a controllable link stream.
class FakeNative extends NativeBridge {
  final StreamController<String> _links = StreamController<String>.broadcast();
  String? initial;
  bool tailscaleResult = false;
  int tailscaleOpens = 0;
  NotificationState notifications = NotificationState.off;
  final List<String> enabledWith = [];
  int disables = 0;

  void emit(String url) => _links.add(url);

  @override
  Stream<String> get links => _links.stream;

  @override
  Future<String?> initialLink() async => initial;

  @override
  Future<bool> openTailscale() async {
    tailscaleOpens++;
    return tailscaleResult;
  }

  @override
  Future<NotificationState> notificationsStatus() async => notifications;

  @override
  Future<void> enableNotifications(String baseUrl) async {
    enabledWith.add(baseUrl);
    notifications = NotificationState.on;
  }

  @override
  Future<void> disableNotifications() async {
    disables++;
    notifications = NotificationState.off;
  }

  @override
  Future<void> setBaseUrl(String url) async {}
}

/// A locator whose state tests set by hand; records what the UI asked of it.
class FakeLocator extends ServerLocator {
  FakeLocator(this.initial);

  final LocatorState initial;
  int retries = 0;
  final List<String> hosts = [];

  @override
  LocatorState build() => initial;

  void set(LocatorState next) => state = next;

  @override
  Future<void> retryNow() async {
    retries++;
  }

  // The real versions wait 20 s on a timer; tests drive the state directly.
  @override
  Future<void> notifyStreamClosed() async {}

  @override
  void notifyStreamOpen() {}

  @override
  Future<void> setManualHost(String input) async {
    final normalized = normalizeManualHost(input);
    hosts.add(normalized);
  }
}

final Uri testBaseUrl = Uri.parse('https://longbow.example.ts.net:8443');

/// Placeholder tabs so shell behavior is tested without the feature screens.
List<ShellTab> testTabs({Widget Function(String name)? body}) {
  Widget content(String name) => body != null ? body(name) : Center(child: Text('$name body'));
  ShellTab tab(AppSectionKey key, String label, IconData icon) => ShellTab(key, label, icon, (_) => content(label));
  return [
    tab(AppSectionKey.feed, 'Feed', LbIcons.message01),
    tab(AppSectionKey.portfolio, 'Portfolio', LbIcons.briefcase01),
    tab(AppSectionKey.markets, 'Markets', LbIcons.globe02),
    tab(AppSectionKey.performance, 'Performance', LbIcons.chartIncrease),
    tab(AppSectionKey.agent, 'Agent', LbIcons.aiBrain01),
  ];
}

class AppHarness {
  AppHarness._(this.api, this.events, this.native, this.locator, this.container, this.toastsSeen);

  final FakeApi api;
  final FakeEvents events;
  final FakeNative native;
  final FakeLocator locator;
  final ProviderContainer container;
  final List<ToastEvent> toastsSeen;

  void toast(ToastEvent e) => container.read(toastQueueProvider).add(e);
}

/// Pumps [home] in the Longbow theme with every provider the shell and gate
/// use replaced by a fake. Returns handles to drive them.
Future<AppHarness> pumpApp(
  WidgetTester tester,
  Widget home, {
  LocatorState? locatorState,
  FakeApi? api,
  Map<String, Object> prefs = const {},
  Size size = const Size(360, 800),
  double textScale = 1.0,
  Brightness brightness = Brightness.dark,
  List<ShellTab>? tabs,
  NavigatorObserver? observer,
  String? initialLink,
  List<Override> overrides = const [],
}) async {
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues(prefs);
  final shared = await SharedPreferences.getInstance();
  final fakeApi = api ?? (FakeApi()..defaults());
  final events = FakeEvents();
  final native = FakeNative()..initial = initialLink;
  final locator = FakeLocator(locatorState ?? Connected(testBaseUrl));
  tester.view.physicalSize = size * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  late ProviderContainer container;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(shared),
        harnessApiProvider.overrideWithValue(fakeApi),
        eventStreamFactoryProvider.overrideWithValue(events.factory),
        outboxRetentionProvider.overrideWithValue(Duration.zero),
        nativeBridgeProvider.overrideWithValue(native),
        serverLocatorProvider.overrideWith(() => locator),
        shellTabsProvider.overrideWithValue(tabs ?? testTabs()),
        ...overrides,
      ],
      child: Builder(
        builder: (context) {
          container = ProviderScope.containerOf(context);
          return MaterialApp(
            theme: buildLongbowTheme(brightness),
            navigatorObservers: [?observer],
            builder: (context, app) => MediaQuery(
              data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
              child: app!,
            ),
            home: home,
          );
        },
      ),
    ),
  );
  final seen = <ToastEvent>[];
  container.listen<AsyncValue<ToastEvent>>(toastEventsProvider, (_, next) => next.whenData(seen.add));
  final h = AppHarness._(fakeApi, events, native, locator, container, seen);
  await settle(tester);
  return h;
}

/// Lets futures and short animations finish without waiting on endless
/// animations (progress bars, pulse dots).
Future<void> settle(WidgetTester tester, [int frames = 8]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 60));
  }
}

/// Platform calls the app made: haptics ('HapticFeedbackType.selectionClick')
/// and requests to leave the app.
class PlatformLog {
  final List<String> haptics = [];
  int exits = 0;
}

PlatformLog recordPlatform(WidgetTester tester) {
  final log = PlatformLog();
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
    if (call.method == 'HapticFeedback.vibrate') log.haptics.add(call.arguments as String);
    if (call.method == 'SystemNavigator.pop') log.exits++;
    return null;
  });
  addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
  return log;
}

/// Sends the app to the background and back through the real lifecycle steps.
void leaveAndReturn(WidgetTester tester) {
  const out = [AppLifecycleState.inactive, AppLifecycleState.hidden, AppLifecycleState.paused];
  const back = [AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed];
  for (final s in [...out, ...back]) {
    tester.binding.handleAppLifecycleStateChanged(s);
  }
}
