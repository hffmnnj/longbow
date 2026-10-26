import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../api/event_stream.dart' show DelayFn;
import '../api/http_client.dart';
import '../native/native_bridge.dart';
import '../state/preferences.dart';

/// Automatic discovery of the harness server on the user's Tailscale network.
///
/// Candidates come from (a) the host the user typed in Settings
/// (`server.host`, tried first), (b) the last host that worked
/// (`server.last`), and (c) the compile-time [hostsConfigProvider] list: a
/// comma-separated list of bare hosts or full URLs supplied through
/// `--dart-define` or `--dart-define-from-file=hosts.local.json`.
///
/// NEVER hardcode a real hostname or IP in source or tests; tests use
/// `longbow.example.ts.net` and `100.101.102.103`.
sealed class LocatorState {
  const LocatorState();

  const factory LocatorState.searching() = Searching;
  const factory LocatorState.connected(Uri baseUrl) = Connected;
  const factory LocatorState.unreachable(
      List<String> tried, bool tailscaleLikely) = Unreachable;
  const factory LocatorState.noHosts() = NoHosts;
}

final class Searching extends LocatorState {
  const Searching();
}

final class Connected extends LocatorState {
  const Connected(this.baseUrl);

  final Uri baseUrl;
}

final class Unreachable extends LocatorState {
  const Unreachable(this.tried, this.tailscaleLikely);

  /// The candidate URL strings that were probed.
  final List<String> tried;

  /// True when a candidate looked like a Tailscale address, so the fix is
  /// probably turning the VPN on rather than typing a host.
  final bool tailscaleLikely;
}

final class NoHosts extends LocatorState {
  const NoHosts();
}

/// Comma-separated bare hosts or full URLs from
/// `--dart-define=LONGBOW_HOSTS=...` or `--dart-define-from-file`.
final hostsConfigProvider = Provider<String>(
    (_) => const String.fromEnvironment('LONGBOW_HOSTS'));

/// Probes one candidate with GET /api/status. Injectable so tests run with
/// fakes and never touch the network.
typedef ProbeFn = Future<bool> Function(Uri url);

Future<bool> probeStatusUrl(Uri url, http.Client client) async {
  try {
    final response = await client
        .get(url.replace(path: '/api/status'),
            headers: {'accept': 'application/json'})
        .timeout(const Duration(seconds: 3));
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch (_) {
    return false;
  }
}

final serverProbeProvider = Provider<ProbeFn>((ref) {
  final client = ref.watch(httpClientProvider);
  return (url) => probeStatusUrl(url, client);
});

final locatorClockProvider =
    Provider<DateTime Function()>( (_) => DateTime.now);

final locatorDelayProvider =
    Provider<DelayFn>((_) => (duration) => Future.delayed(duration));

/// Seconds between automatic retries while unreachable (10 s default).
final locatorRetryIntervalProvider =
    Provider<Duration>((_) => const Duration(seconds: 10));

/// How long after the first success an HTTPS success may still win the race.
final locatorHttpsGraceProvider =
    Provider<Duration>((_) => const Duration(milliseconds: 600));

/// Connectivity changes; the locator re-probes on any change while
/// unreachable. Overridden in tests with a controlled stream.
final connectivityChangesProvider =
    StreamProvider<List<ConnectivityResult>>(
        (_) => Connectivity().onConnectivityChanged);

/// A bare host expands to both server endpoints; a `host:port` entry keeps
/// its port (4520 implies plain HTTP, anything else HTTPS); a full URL is
/// used as-is with any path, query, or fragment dropped.
List<Uri> expandHostEntry(String entry) {
  final text = entry.trim().toLowerCase();
  if (text.isEmpty) return const [];
  if (text.contains('://')) {
    final uri = Uri.tryParse(text);
    if (uri == null ||
        (uri.scheme != 'http' && uri.scheme != 'https') ||
        uri.host.isEmpty) {
      return const [];
    }
    var out = '${uri.scheme}://${uri.host}';
    if (uri.hasPort) out += ':${uri.port}';
    return [Uri.parse(out)];
  }
  if (text.contains(' ') || text.contains('/')) return const [];
  final colon = text.lastIndexOf(':');
  if (colon > 0) {
    final port = int.tryParse(text.substring(colon + 1));
    final host = text.substring(0, colon);
    if (host.isNotEmpty && port != null && port >= 1 && port <= 65535) {
      final scheme = port == 4520 ? 'http' : 'https';
      return [Uri.parse('$scheme://$host:$port')];
    }
    return const [];
  }
  return [Uri.parse('https://$text:8443'), Uri.parse('http://$text:4520')];
}

/// Ordered, de-duplicated probe candidates: saved host, last host, then the
/// compile-time list.
List<Uri> buildCandidates({
  String? savedHost,
  String? lastHost,
  String hostsConfig = '',
}) {
  final seen = <String>{};
  final out = <Uri>[];
  final entries = [
    if (savedHost != null && savedHost.trim().isNotEmpty) savedHost,
    if (lastHost != null && lastHost.trim().isNotEmpty) lastHost,
    ...hostsConfig.split(','),
  ];
  for (final entry in entries) {
    for (final url in expandHostEntry(entry)) {
      if (seen.add(url.toString())) out.add(url);
    }
  }
  return out;
}

bool looksLikeTailscale(Uri url) {
  final host = url.host.toLowerCase();
  return host.endsWith('.ts.net') || host.startsWith('100.');
}

/// Validates and normalizes user input such as `myhost.ts.net`,
/// `100.101.102.103:4520`, or `https://x`. Returns the string to persist
/// under `server.host` (bare hosts stay bare; the probe expands them).
/// Throws [FormatException] on anything that cannot address a server.
String normalizeManualHost(String input) {
  final text = input.trim().toLowerCase();
  if (text.isEmpty) throw const FormatException('Enter a host');
  if (text.contains('://')) {
    final uri = Uri.tryParse(text);
    if (uri == null ||
        (uri.scheme != 'http' && uri.scheme != 'https') ||
        uri.host.isEmpty) {
      throw const FormatException('Use http(s)://host[:port]');
    }
    var out = '${uri.scheme}://${uri.host}';
    if (uri.hasPort) out += ':${uri.port}';
    return out;
  }
  if (text.contains(' ') || text.contains('/')) {
    throw const FormatException('Use a host or IP, optionally with :port');
  }
  final colon = text.lastIndexOf(':');
  if (colon >= 0) {
    final host = text.substring(0, colon);
    final port = int.tryParse(text.substring(colon + 1));
    if (host.isEmpty || port == null || port < 1 || port > 65535) {
      throw const FormatException('Use a host or IP, optionally with :port');
    }
    return '$host:$port';
  }
  return text;
}

class ServerLocator extends Notifier<LocatorState> {
  static const String savedHostKey = 'server.host';
  static const String lastHostKey = 'server.last';

  late SharedPreferences _prefs;
  bool _probing = false;
  bool _again = false;
  int _unreachableGen = 0;
  int _dropGen = 0;

  ProbeFn get _probe => ref.read(serverProbeProvider);
  DateTime Function() get _now => ref.read(locatorClockProvider);
  DelayFn get _delay => ref.read(locatorDelayProvider);
  Duration get _retryInterval => ref.read(locatorRetryIntervalProvider);
  Duration get _httpsGrace => ref.read(locatorHttpsGraceProvider);
  NativeBridge get _native => ref.read(nativeBridgeProvider);

  @override
  LocatorState build() {
    _prefs = ref.watch(sharedPreferencesProvider);
    // NOTE: ref.watch (not ref.listen) keeps the connectivity subscription
    // alive: a bare listen inside build never activates a StreamProvider
    // unless something else subscribes too. Either way the locator only
    // reacts while something watches it (the shell does); an inactive
    // provider's subscriptions stay paused.
    ref.watch(connectivityChangesProvider).whenData(_onConnectivityData);
    if (_initialized) return state;
    _initialized = true;
    final candidates = _candidates();
    if (candidates.isEmpty) return const LocatorState.noHosts();
    // Deferred past build: writing state (via _probeOnce -> _set) while the
    // provider is still initializing is illegal.
    unawaited(Future.microtask(retryNow));
    return const LocatorState.searching();
  }

  bool _initialized = false;
  List<ConnectivityResult>? _lastConnectivity;

  void _onConnectivityData(List<ConnectivityResult> results) {
    if (identical(results, _lastConnectivity)) return;
    _lastConnectivity = results;
    if (_initialized && state is Unreachable) {
      unawaited(Future.microtask(retryNow));
    }
  }

  List<Uri> _candidates() => buildCandidates(
        savedHost: _prefs.getString(savedHostKey),
        lastHost: _prefs.getString(lastHostKey),
        hostsConfig: ref.read(hostsConfigProvider),
      );

  void _set(LocatorState next) {
    state = next;
    if (next is Unreachable) {
      _unreachableGen++;
      unawaited(_unreachableLoop(_unreachableGen));
    } else {
      // Connected, Searching, or NoHosts: stop the retry loop.
      _unreachableGen++;
    }
  }

  /// Probe once now. Serialized: a call made mid-probe schedules a repeat.
  Future<void> retryNow() async {
    if (_probing) {
      _again = true;
      return;
    }
    _probing = true;
    try {
      do {
        _again = false;
        await _probeOnce();
      } while (_again);
    } finally {
      _probing = false;
    }
  }

  Future<void> _probeOnce() async {
    final candidates = _candidates();
    if (candidates.isEmpty) {
      _set(const LocatorState.noHosts());
      return;
    }
    if (state is! Searching) _set(const LocatorState.searching());
    final winner = await _race(candidates);
    final tried = candidates.map((u) => u.toString()).toList();
    if (winner == null) {
      _set(LocatorState.unreachable(
          tried, candidates.any(looksLikeTailscale)));
    } else {
      await _prefs.setString(lastHostKey, winner.toString());
      await _native.setBaseUrl(winner.toString());
      _set(LocatorState.connected(winner));
    }
  }

  /// First success wins, except an HTTPS success within [_httpsGrace] of a
  /// first HTTP success still takes it (HTTPS on 8443 is the preferred
  /// MagicDNS endpoint).
  Future<Uri?> _race(List<Uri> candidates) {
    final done = Completer<Uri?>();
    Uri? first;
    DateTime? firstAt;
    var remaining = candidates.length;

    void onResult(Uri url, bool ok) {
      if (done.isCompleted) return;
      remaining--;
      if (ok) {
        if (first == null) {
          first = url;
          firstAt = _now();
          if (url.scheme == 'https') {
            done.complete(url);
            return;
          }
          _delay(_httpsGrace).then((_) {
            if (!done.isCompleted) done.complete(first);
          });
        } else if (url.scheme == 'https' &&
            !_now().difference(firstAt!).isNegative &&
            _now().difference(firstAt!) <= _httpsGrace) {
          done.complete(url);
          return;
        }
      }
      if (remaining == 0 && !done.isCompleted) done.complete(first);
    }

    for (final url in candidates) {
      _probe(url).then((ok) => onResult(url, ok));
    }
    return done.future;
  }

  Future<void> _unreachableLoop(int gen) async {
    while (gen == _unreachableGen && state is Unreachable) {
      await _delay(_retryInterval);
      if (gen == _unreachableGen && state is Unreachable) {
        await retryNow();
      }
    }
  }

  /// The shell calls this when the app returns to the foreground.
  void onForeground() {
    if (state is Unreachable) unawaited(retryNow());
  }

  /// Called by the harness store when its live stream drops: re-probe if the
  /// outage lasts more than 20 seconds.
  Future<void> notifyStreamClosed() async {
    if (state is! Connected) return;
    _dropGen++;
    final gen = _dropGen;
    await _delay(const Duration(seconds: 20));
    if (gen == _dropGen && state is Connected) await retryNow();
  }

  /// Called by the harness store when its live stream (re)opens.
  void notifyStreamOpen() {
    _dropGen++;
  }

  /// Validates [input], persists it as the saved host, and re-probes.
  /// Throws [FormatException] on invalid input.
  Future<void> setManualHost(String input) async {
    final normalized = normalizeManualHost(input);
    await _prefs.setString(savedHostKey, normalized);
    await ref.read(preferencesProvider.notifier).setHost(normalized);
    await retryNow();
  }

  /// The connected base URL, or null until the locator connects.
  Uri? get baseUrl {
    final current = state;
    return current is Connected ? current.baseUrl : null;
  }
}

final serverLocatorProvider =
    NotifierProvider<ServerLocator, LocatorState>(ServerLocator.new);
