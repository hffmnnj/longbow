import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_update.dart';
import 'deep_link.dart';

/// Alert-service state reported by the Kotlin foreground service.
enum NotificationState { on, off, blocked }

/// Typed wrapper over the `longbow/native` method channel declared in
/// MainActivity: notification on/off/blocked, the server base URL the
/// foreground alert service streams from, a shortcut into the Tailscale app,
/// and the deep link a notification tap carried.
///
/// Notification, Tailscale and link calls stay safe no-ops returning a default
/// when the channel is missing (plain tests, desktop): no plugin, no crash.
/// Updater calls instead surface platform failures to the caller so the
/// settings section can stay honest; a missing updater plugin throws
/// [MissingPluginException] rather than pretending the state is idle.
class NativeBridge {
  NativeBridge({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel('longbow/native');

  final MethodChannel _channel;
  final _links = StreamController<String>.broadcast();
  bool _handlerSet = false;

  /// The method handler is installed lazily so constructing a bridge never
  /// needs a Flutter binding (plain unit tests, desktop).
  void _ensureHandler() {
    if (_handlerSet) return;
    _handlerSet = true;
    try {
      _channel.setMethodCallHandler(_onCall);
    } catch (_) {
      // No binding (or no channel): incoming links simply never arrive.
    }
  }

  Future<void> _onCall(MethodCall call) async {
    if (call.method == 'openUrl') {
      final args = call.arguments;
      final url = args is Map ? args['url'] : null;
      if (url is String && url.isNotEmpty) _links.add(url);
    } else if (call.method == 'updateState') {
      _updates.add(call.arguments);
    }
  }

  final _updates = StreamController<Object?>.broadcast();

  /// Updater state pushed by Kotlin whenever it changes (raw native maps).
  Stream<Object?> get updateStates {
    _ensureHandler();
    return _updates.stream;
  }

  /// The updater's current state. Throws when the native side reports a
  /// failure or the plugin is missing so the caller can show it.
  Future<Object?> updatesState() async {
    _ensureHandler();
    return _channel.invokeMethod<Object?>('updatesState');
  }

  /// Asks the updater to check [baseUrl] (it coalesces and rate-limits unless
  /// [force]) and returns its state. Throws on native failure or a missing
  /// plugin.
  Future<Object?> updatesCheck(String baseUrl, {bool force = false}) async {
    _ensureHandler();
    return _channel.invokeMethod<Object?>('updatesCheck', {'baseUrl': baseUrl, 'force': force});
  }

  /// Verifies the downloaded APK again and opens the system installer on it.
  /// Throws when the native side cannot answer so the UI can explain why.
  Future<InstallOutcome> updatesInstall() async {
    _ensureHandler();
    final value = await _channel.invokeMethod<String>('updatesInstall');
    return switch (value) {
      'started' => InstallOutcome.started,
      'needsPermission' => InstallOutcome.needsPermission,
      'invalid' => InstallOutcome.invalid,
      _ => InstallOutcome.notReady,
    };
  }

  /// Opens Android's "Install unknown apps" screen for Longbow.
  /// Throws when the native side cannot open it.
  Future<void> openInstallSettings() async {
    _ensureHandler();
    await _channel.invokeMethod<void>('updatesOpenInstallSettings');
  }

  /// Deep links forwarded from notification taps while the app runs.
  Stream<String> get links {
    _ensureHandler();
    return _links.stream;
  }

  Future<NotificationState> notificationsStatus() async {
    _ensureHandler();
    try {
      final value = await _channel.invokeMethod<String>('notificationsStatus');
      return switch (value) {
        'on' => NotificationState.on,
        'blocked' => NotificationState.blocked,
        _ => NotificationState.off,
      };
    } catch (_) {
      return NotificationState.off;
    }
  }

  Future<void> enableNotifications(String baseUrl) async {
    _ensureHandler();
    try {
      await _channel.invokeMethod<void>(
          'notificationsEnable', {'baseUrl': baseUrl});
    } catch (_) {
      // Missing channel: the toggle mirror still updates in Dart.
    }
  }

  Future<void> disableNotifications() async {
    _ensureHandler();
    try {
      await _channel.invokeMethod<void>('notificationsDisable');
    } catch (_) {
      // Missing channel: safe no-op.
    }
  }

  Future<void> setBaseUrl(String url) async {
    _ensureHandler();
    try {
      await _channel.invokeMethod<void>('setBaseUrl', {'baseUrl': url});
    } catch (_) {
      // Missing channel: safe no-op.
    }
  }

  /// Opens the Tailscale app (or its download page). True when the app
  /// itself was launched.
  Future<bool> openTailscale() async {
    _ensureHandler();
    try {
      return await _channel.invokeMethod<bool>('openTailscale') ?? false;
    } catch (_) {
      return false;
    }
  }

  /// The link a cold start from a notification tap carried, if any.
  Future<String?> initialLink() async {
    _ensureHandler();
    try {
      return await _channel.invokeMethod<String>('getInitialUrl');
    } catch (_) {
      return null;
    }
  }

  void dispose() {
    unawaited(_links.close());
    unawaited(_updates.close());
  }
}

/// The app-scoped bridge. Tests override this with a fake subclass or a
/// bridge over a mocked [MethodChannel].
final nativeBridgeProvider = Provider<NativeBridge>((ref) {
  final bridge = NativeBridge();
  ref.onDispose(bridge.dispose);
  return bridge;
});

/// The cold-start notification link, parsed, or null when the app was not
/// opened from a notification.
final initialDeepLinkProvider = FutureProvider<DeepLink?>((ref) async {
  final url = await ref.watch(nativeBridgeProvider).initialLink();
  return parseDeepLink(url);
});

/// Notification-tap links arriving while the app runs, parsed; unparsable
/// payloads are skipped.
final nativeLinkProvider = StreamProvider<DeepLink>((ref) async* {
  await for (final url in ref.watch(nativeBridgeProvider).links) {
    final link = parseDeepLink(url);
    if (link != null) yield link;
  }
});
