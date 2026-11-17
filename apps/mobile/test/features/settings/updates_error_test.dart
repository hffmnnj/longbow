import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/data.dart';

import '../../app/app_harness.dart';

/// Updater bridge that fails the way the real channel does: platform errors
/// throw instead of pretending the state is idle. Results are mutable so one
/// test can sync a good snapshot and then fail the next call, proving the
/// error keeps the known release.
class ThrowingNative extends NativeBridge {
  ThrowingNative({this.stateResult, this.stateError, this.checkError, this.installError, this.settingsError});

  Object? stateResult;
  Object? stateError;
  Object? checkError;
  Object? installError;
  Object? settingsError;
  final _updates = StreamController<Object?>.broadcast();

  @override
  Stream<Object?> get updateStates => _updates.stream;

  @override
  Future<Object?> updatesState() async {
    if (stateError != null) throw stateError!;
    return stateResult;
  }

  @override
  Future<Object?> updatesCheck(String baseUrl, {bool force = false}) async {
    if (checkError != null) throw checkError!;
    return stateResult;
  }

  @override
  Future<InstallOutcome> updatesInstall() async {
    if (installError != null) throw installError!;
    return InstallOutcome.notReady;
  }

  @override
  Future<void> openInstallSettings() async {
    if (settingsError != null) throw settingsError!;
  }

  @override
  void dispose() {
    unawaited(_updates.close());
    super.dispose();
  }
}

Map<String, Object?> goodSnapshot() => {
      'status': 'current',
      'release': {
        'id': 'r2',
        'version': '1.0.2',
        'title': 'Faster charts',
        'notes': 'Charts draw sooner.',
        'publishedAt': 1700000000000,
      },
      'android': {'versionCode': 3, 'versionName': '1.0.2', 'size': 20 * 1024 * 1024},
      'downloaded': 0,
      'installedVersionCode': 2,
      'installedVersionName': '1.0.1',
      'canInstall': true,
    };

ProviderContainer makeContainer(ThrowingNative native) {
  final container = ProviderContainer(
    overrides: [
      nativeBridgeProvider.overrideWithValue(native),
      serverLocatorProvider.overrideWith(() => FakeLocator(Connected(testBaseUrl))),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  test('updateState_copyWith_setsErrorButKeepsReleaseAndInstalled', () {
    final known = AppUpdateState(
      status: UpdateStatus.current,
      release: ReleaseNotes(
        id: 'r2',
        version: '1.0.2',
        title: 'T',
        notes: 'N',
        publishedAt: DateTime.fromMillisecondsSinceEpoch(1700000000000),
      ),
      android: const AndroidBuild(versionCode: 3, versionName: '1.0.2', size: 10),
      installedVersionCode: 2,
      installedVersionName: '1.0.1',
    );
    final failed = known.copyWith(
      status: UpdateStatus.error,
      errorCode: 'unreachable',
      errorMessage: 'Could not reach the server.',
    );
    expect(failed.status, UpdateStatus.error);
    expect(failed.errorCode, 'unreachable');
    expect(failed.release?.version, '1.0.2');
    expect(failed.android?.versionCode, 3);
    expect(failed.installedLabel, '1.0.1 (2)');
  });

  test('sync_missingPlugin_becomesUnavailableErrorInsteadOfIdle', () async {
    final native = ThrowingNative(
      stateError: MissingPluginException('No implementation found for method updatesState'),
    );
    final container = makeContainer(native);

    await container.read(appUpdateProvider.notifier).sync();

    final state = container.read(appUpdateProvider);
    expect(state.status, UpdateStatus.error);
    expect(state.errorCode, 'unavailable');
    expect(state.errorMessage, contains('not available'));
  });

  test('check_platformFailure_saysWhyInsteadOfPretendingIdle', () async {
    final native = ThrowingNative(
      checkError: PlatformException(code: 'unreachable', message: 'Could not reach the server.'),
    );
    final container = makeContainer(native);

    await container.read(appUpdateProvider.notifier).check(force: true);

    final state = container.read(appUpdateProvider);
    expect(state.status, UpdateStatus.error);
    expect(state.errorCode, 'unreachable');
    expect(state.errorMessage, 'Could not reach the server.');
  });

  test('sync_failureKeepsKnownReleaseAndInstalled', () async {
    final native = ThrowingNative(stateResult: goodSnapshot());
    final container = makeContainer(native);
    final controller = container.read(appUpdateProvider.notifier);

    await controller.sync();
    expect(container.read(appUpdateProvider).release?.version, '1.0.2');

    native.stateError = PlatformException(code: 'unreachable', message: 'Could not reach the server.');
    await controller.sync();

    final failed = container.read(appUpdateProvider);
    expect(failed.status, UpdateStatus.error);
    expect(failed.release?.version, '1.0.2');
    expect(failed.android?.versionCode, 3);
    expect(failed.installedLabel, '1.0.1 (2)');
  });

  test('install_failure_surfacesErrorAndClearsInstallingWithoutThrowing', () async {
    final native = ThrowingNative(
      installError: PlatformException(code: 'failed', message: 'Could not start the installer.'),
    );
    final container = makeContainer(native);

    await container.read(appUpdateProvider.notifier).install();

    final state = container.read(appUpdateProvider);
    expect(state.status, UpdateStatus.error);
    expect(state.errorMessage, 'Could not start the installer.');
    expect(state.installing, isFalse);
  });

  test('openSettings_failure_surfacesErrorWithoutThrowing', () async {
    final native = ThrowingNative(
      settingsError: PlatformException(code: 'failed', message: 'Could not open the install settings.'),
    );
    final container = makeContainer(native);

    await container.read(appUpdateProvider.notifier).openInstallSettings();

    expect(container.read(appUpdateProvider).status, UpdateStatus.error);
  });
}
