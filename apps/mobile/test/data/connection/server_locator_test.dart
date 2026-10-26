import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/connection/server_locator.dart';
import 'package:longbow/data/native/native_bridge.dart';
import 'package:longbow/data/state/preferences.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../fake_clock.dart';

class FakeNative extends NativeBridge {
  final urls = <String>[];

  @override
  Future<void> setBaseUrl(String url) async {
    urls.add(url);
  }
}

class FakeProber {
  final log = <Uri>[];
  final answers = <String, bool>{};
  final gates = <String, Completer<bool>>{};

  Future<bool> call(Uri url) {
    log.add(url);
    final gate = gates.remove(url.toString());
    if (gate != null) return gate.future;
    return Future.value(answers[url.toString()] ?? false);
  }

  void allowAll() => answers['*'] = true;

  Future<bool> callWithWildcard(Uri url) {
    log.add(url);
    final gate = gates.remove(url.toString());
    if (gate != null) return gate.future;
    return Future.value(answers[url.toString()] ?? answers['*'] ?? false);
  }
}

class Harness {
  Harness._();

  static Future<Harness> create({
    Map<String, Object> prefs = const {},
    String hostsConfig = '',
    FakeProber? prober,
    Duration retryInterval = const Duration(seconds: 10),
  }) async {
    SharedPreferences.setMockInitialValues(prefs);
    final shared = await SharedPreferences.getInstance();
    final clock = ManualClock();
    final waits = <Duration>[];
    final probe = prober ?? FakeProber();
    final native = FakeNative();
    final connectivity = StreamController<List<ConnectivityResult>>.broadcast();
    final container = ProviderContainer(overrides: [
      sharedPreferencesProvider.overrideWithValue(shared),
      hostsConfigProvider.overrideWithValue(hostsConfig),
      serverProbeProvider.overrideWithValue(probe.callWithWildcard),
      locatorClockProvider.overrideWithValue(clock.call),
      locatorDelayProvider.overrideWithValue((d) {
        waits.add(d);
        return clock.delay(d);
      }),
      locatorRetryIntervalProvider.overrideWithValue(retryInterval),
      nativeBridgeProvider.overrideWithValue(native),
      connectivityChangesProvider.overrideWith((ref) => connectivity.stream),
    ]);
    addTearDown(() async {
      container.dispose();
      await connectivity.close();
      native.dispose();
    });
    // Riverpod pauses providers with no listeners: hold the locator active
    // exactly as the production shell (which watches it) does, or
    // connectivity events never reach it.
    container.listen<LocatorState>(serverLocatorProvider, (_, _) {});
    final h = Harness._()
      ..container = container
      ..clock = clock
      ..waits = waits
      ..prober = probe
      ..native = native
      ..connectivity = connectivity
      ..shared = shared;
    return h;
  }

  late ProviderContainer container;
  late ManualClock clock;
  late List<Duration> waits;
  late FakeProber prober;
  late FakeNative native;
  late StreamController<List<ConnectivityResult>> connectivity;
  late SharedPreferences shared;

  LocatorState get state => container.read(serverLocatorProvider);
  ServerLocator get notifier =>
      container.read(serverLocatorProvider.notifier);

  Future<void> start() async {
    container.read(serverLocatorProvider);
    await clock.pump();
  }
}

void main() {
  group('candidate building', () {
    test('bare hosts expand to https 8443 and http 4520 in order', () {
      expect(
        buildCandidates(hostsConfig: 'longbow.example.ts.net')
            .map((u) => u.toString()),
        [
          'https://longbow.example.ts.net:8443',
          'http://longbow.example.ts.net:4520',
        ],
      );
    });

    test('saved host first, then last, then config, de-duplicated', () {
      final out = buildCandidates(
        savedHost: 'longbow.example.ts.net',
        lastHost: 'https://longbow.example.ts.net:8443',
        hostsConfig: 'longbow.example.ts.net, 100.101.102.103:4520',
      ).map((u) => u.toString());
      expect(out, [
        'https://longbow.example.ts.net:8443',
        'http://longbow.example.ts.net:4520',
        'http://100.101.102.103:4520',
      ]);
    });

    test('full URLs are used as-is without path or query', () {
      expect(
        buildCandidates(
                hostsConfig: 'https://longbow.example.ts.net:9999/a?b=c')
            .map((u) => u.toString()),
        ['https://longbow.example.ts.net:9999'],
      );
    });

    test('host:port keeps its port with an inferred scheme', () {
      expect(
        buildCandidates(hostsConfig: '100.101.102.103:4520')
            .map((u) => u.toString()),
        ['http://100.101.102.103:4520'],
      );
      expect(
        buildCandidates(hostsConfig: '100.101.102.103:8443')
            .map((u) => u.toString()),
        ['https://100.101.102.103:8443'],
      );
    });

    test('invalid entries are skipped', () {
      expect(buildCandidates(hostsConfig: 'ftp://x, ,nota host,,ok.ts.net'),
          hasLength(2));
    });
  });

  group('normalizeManualHost', () {
    test('normalizes bare hosts, host:port, and full URLs', () {
      expect(normalizeManualHost('MyHost.TS.NET '), 'myhost.ts.net');
      expect(normalizeManualHost('100.101.102.103:4520'),
          '100.101.102.103:4520');
      expect(normalizeManualHost('https://X:9999/'), 'https://x:9999');
    });

    test('rejects blanks, spaces, bad schemes, and bad ports', () {
      for (final bad in [
        '',
        '   ',
        'nota host',
        'a/b',
        'ftp://x',
        'http://',
        'host:abc',
        'host:0',
        'host:99999',
        ':4520',
      ]) {
        expect(() => normalizeManualHost(bad), throwsFormatException,
            reason: bad);
      }
    });
  });

  group('ServerLocator', () {
    test('no hosts anywhere yields NoHosts without probing', () async {
      final h = await Harness.create(hostsConfig: '');
      await h.start();
      expect(h.state, isA<NoHosts>());
      expect(h.prober.log, isEmpty);
    });

    test('saved host is tried first and wins', () async {
      final prober = FakeProber()..allowAll();
      final h = await Harness.create(
        prefs: {
          'server.host': 'longbow.example.ts.net',
          'server.last': '100.101.102.103',
        },
        hostsConfig: 'cached.example.ts.net',
        prober: prober,
      );
      await h.start();
      final state = h.state;
      expect(state, isA<Connected>());
      expect((state as Connected).baseUrl.toString(),
          'https://longbow.example.ts.net:8443');
      expect(prober.log.first.toString(),
          'https://longbow.example.ts.net:8443');
      // Success persists the last host and tells the native service.
      expect(h.shared.getString('server.last'),
          'https://longbow.example.ts.net:8443');
      expect(h.native.urls,
          ['https://longbow.example.ts.net:8443']);
    });

    test('an http-only success connects over plain HTTP', () async {
      final prober = FakeProber()
        ..answers['http://longbow.example.ts.net:4520'] = true;
      final h = await Harness.create(
        hostsConfig: 'longbow.example.ts.net',
        prober: prober,
      );
      await h.start();
      expect((h.state as Connected).baseUrl.toString(),
          'http://longbow.example.ts.net:4520');
    });

    test('https arriving within the grace window beats an http first',
        () async {
      final prober = FakeProber();
      final h = await Harness.create(
        prefs: {'server.host': 'http://longbow.example.ts.net:4520'},
        hostsConfig: 'longbow.example.ts.net',
        prober: prober,
      );
      prober.answers['http://longbow.example.ts.net:4520'] = true;
      final httpsGate = Completer<bool>();
      prober.gates['https://longbow.example.ts.net:8443'] = httpsGate;
      h.container.read(serverLocatorProvider);
      await h.clock.pump();
      // HTTP answered; the race still waits out the HTTPS grace.
      expect(h.state, isA<Searching>());
      await h.clock.advance(const Duration(milliseconds: 100));
      httpsGate.complete(true);
      await h.clock.pump();
      expect((h.state as Connected).baseUrl.toString(),
          'https://longbow.example.ts.net:8443');
    });

    test('https arriving after the grace window loses', () async {
      final prober = FakeProber();
      final h = await Harness.create(
        prefs: {'server.host': 'http://longbow.example.ts.net:4520'},
        hostsConfig: 'longbow.example.ts.net',
        prober: prober,
      );
      prober.answers['http://longbow.example.ts.net:4520'] = true;
      final httpsGate = Completer<bool>();
      prober.gates['https://longbow.example.ts.net:8443'] = httpsGate;
      h.container.read(serverLocatorProvider);
      await h.clock.pump();
      await h.clock.advance(const Duration(milliseconds: 700));
      expect((h.state as Connected).baseUrl.toString(),
          'http://longbow.example.ts.net:4520');
      httpsGate.complete(true);
      await h.clock.pump();
      expect((h.state as Connected).baseUrl.toString(),
          'http://longbow.example.ts.net:4520');
    });

    test('total failure yields Unreachable with a tailscale hint', () async {
      final h = await Harness.create(hostsConfig: 'longbow.example.ts.net');
      await h.start();
      final state = h.state;
      expect(state, isA<Unreachable>());
      final unreachable = state as Unreachable;
      expect(unreachable.tried, [
        'https://longbow.example.ts.net:8443',
        'http://longbow.example.ts.net:4520',
      ]);
      expect(unreachable.tailscaleLikely, isTrue);
    });

    test('non-tailscale failures do not suggest the VPN', () async {
      final h = await Harness.create(hostsConfig: 'plain.example.com');
      await h.start();
      expect((h.state as Unreachable).tailscaleLikely, isFalse);
    });

    test('retryNow reprobes and connects when the server appears', () async {
      final prober = FakeProber();
      final h = await Harness.create(
          hostsConfig: 'longbow.example.ts.net', prober: prober);
      await h.start();
      expect(h.state, isA<Unreachable>());
      final probes = prober.log.length;
      prober.allowAll();
      await h.notifier.retryNow();
      await h.clock.pump();
      expect(h.state, isA<Connected>());
      expect(prober.log.length, greaterThan(probes));
    });

    test('the retry loop reprobes every interval while unreachable',
        () async {
      final prober = FakeProber();
      final h = await Harness.create(
          hostsConfig: 'longbow.example.ts.net', prober: prober);
      await h.start();
      final probes = prober.log.length;
      await h.clock.advance(const Duration(seconds: 10));
      await h.clock.pump();
      expect(prober.log.length, greaterThan(probes));
      expect(h.state, isA<Unreachable>());
    });

    test('setManualHost validates, persists, and reprobes', () async {
      final prober = FakeProber()..allowAll();
      final h = await Harness.create(hostsConfig: '', prober: prober);
      await h.start();
      expect(h.state, isA<NoHosts>());
      await h.notifier.setManualHost('MyHost.TS.NET ');
      await h.clock.pump();
      expect((h.state as Connected).baseUrl.toString(),
          'https://myhost.ts.net:8443');
      expect(h.shared.getString('server.host'), 'myhost.ts.net');
      await expectLater(
          h.notifier.setManualHost('nota host'), throwsFormatException);
    });

    test('connectivity changes re-probe only while unreachable', () async {
      final prober = FakeProber();
      final h = await Harness.create(
          hostsConfig: 'longbow.example.ts.net', prober: prober);
      await h.start();
      final probes = prober.log.length;
      h.connectivity.add([ConnectivityResult.wifi]);
      await h.clock.pump();
      expect(prober.log.length, greaterThan(probes));

      prober.allowAll();
      await h.notifier.retryNow();
      await h.clock.pump();
      expect(h.state, isA<Connected>());
      final connected = prober.log.length;
      h.connectivity.add([ConnectivityResult.none]);
      await h.clock.pump();
      expect(prober.log.length, connected);
    });

    test('foreground return re-probes while unreachable', () async {
      final prober = FakeProber();
      final h = await Harness.create(
          hostsConfig: 'longbow.example.ts.net', prober: prober);
      await h.start();
      final probes = prober.log.length;
      h.notifier.onForeground();
      await h.clock.pump();
      expect(prober.log.length, greaterThan(probes));
    });

    test('a stream drop longer than 20s re-probes; a quick recovery does not',
        () async {
      final prober = FakeProber()..allowAll();
      final h = await Harness.create(
        hostsConfig: 'https://longbow.example.ts.net:8443',
        prober: prober,
      );
      await h.start();
      expect(h.state, isA<Connected>());
      final probes = prober.log.length;

      unawaited(h.notifier.notifyStreamClosed());
      await h.clock.advance(const Duration(seconds: 19));
      await h.clock.pump();
      expect(prober.log.length, probes);

      h.notifier.notifyStreamOpen();
      await h.clock.advance(const Duration(seconds: 30));
      await h.clock.pump();
      expect(prober.log.length, probes);

      unawaited(h.notifier.notifyStreamClosed());
      await h.clock.advance(const Duration(seconds: 21));
      await h.clock.pump();
      expect(prober.log.length, greaterThan(probes));
    });
  });
}
