import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../connection/server_locator.dart';
import '../native/app_update.dart';
import '../native/native_bridge.dart';

/// Dart face of the Kotlin updater: mirrors its state, asks it to check, and
/// starts the install. The updater owns the download, verification and the
/// single running job; this only reflects it, so a restart of the app (or a
/// check from the alert service) shows up here without any Dart bookkeeping.
///
/// Native failures are honest: a missing plugin or a platform error becomes a
/// concise `error` state that keeps the known release/installed metadata, so
/// the section can say why instead of pretending nothing happened.
class AppUpdateController extends Notifier<AppUpdateState> {
  NativeBridge get _native => ref.read(nativeBridgeProvider);

  @override
  AppUpdateState build() {
    final sub = ref.watch(nativeBridgeProvider).updateStates.listen(_adopt, onError: (_) {});
    ref.onDispose(sub.cancel);
    unawaited(Future.microtask(sync));
    return const AppUpdateState();
  }

  void _adopt(Object? raw) {
    if (raw is! Map) return;
    state = AppUpdateState.fromMap(raw, installDenied: state.installDenied, installing: state.installing);
  }

  /// Keeps the known release/installed metadata and explains the failure.
  AppUpdateState _toError(Object e, String fallback) {
    if (e is MissingPluginException) {
      return state.copyWith(
        status: UpdateStatus.error,
        errorCode: 'unavailable',
        errorMessage: 'Updates are not available in this build.',
        installing: false,
      );
    }
    if (e is PlatformException) {
      final code = e.code.isEmpty ? 'failed' : e.code;
      final message = (e.message?.isNotEmpty ?? false) ? e.message! : fallback;
      return state.copyWith(status: UpdateStatus.error, errorCode: code, errorMessage: message, installing: false);
    }
    return state.copyWith(status: UpdateStatus.error, errorCode: 'failed', errorMessage: fallback, installing: false);
  }

  /// Reads the updater's current state without asking it to check.
  Future<void> sync() async {
    try {
      _adopt(await _native.updatesState());
    } catch (e) {
      state = _toError(e, 'Could not read the update state.');
    }
  }

  /// Asks the updater to check the connected server. It coalesces with a
  /// running job and, unless [force], skips a check that came right after
  /// the last one. [force] is for explicit taps and release hints.
  Future<void> check({bool force = false}) async {
    try {
      final locator = ref.read(serverLocatorProvider);
      if (locator is! Connected) {
        await sync();
        return;
      }
      _adopt(await _native.updatesCheck(locator.baseUrl.toString(), force: force));
    } catch (e) {
      state = _toError(e, 'Could not check for updates.');
    }
  }

  /// Install tap. The native side verifies the file again and opens the system
  /// installer; if Android has not allowed installs yet the state says so and
  /// the section offers the settings screen.
  Future<void> install() async {
    if (state.installing) return;
    state = state.copyWith(installing: true);
    try {
      final outcome = await _native.updatesInstall();
      state = state.copyWith(installDenied: outcome == InstallOutcome.needsPermission);
      if (outcome == InstallOutcome.notReady || outcome == InstallOutcome.invalid) await sync();
    } catch (e) {
      state = _toError(e, 'Could not start the installer.');
    } finally {
      if (state.installing) state = state.copyWith(installing: false);
    }
  }

  Future<void> openInstallSettings() async {
    try {
      await _native.openInstallSettings();
    } catch (e) {
      state = _toError(e, 'Could not open the install settings.');
    }
  }
}

final appUpdateProvider = NotifierProvider<AppUpdateController, AppUpdateState>(AppUpdateController.new);
