import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/settings/settings_sections.dart';

import '../../app/app_harness.dart';

Map<String, Object?> _snapshot(
  String status, {
  bool canInstall = true,
  int downloaded = 0,
  String? errorMessage,
}) =>
    {
      'status': status,
      'errorMessage': errorMessage,
      'release': {
        'id': 'r2',
        'version': '1.0.2',
        'title': 'Faster charts',
        'notes': 'Charts draw sooner.',
        'publishedAt': 1700000000000,
      },
      'android': {'versionCode': 3, 'versionName': '1.0.2', 'size': 20 * 1024 * 1024},
      'downloaded': downloaded,
      'installedVersionCode': 2,
      'installedVersionName': '1.0.1',
      'canInstall': canInstall,
    };

Future<AppHarness> _pump(WidgetTester tester, Map<String, Object?> snapshot, {Map<String, Object> prefs = const {}}) async {
  final h = await pumpApp(
    tester,
    const Scaffold(body: SingleChildScrollView(child: UpdatesSection())),
    prefs: prefs,
    // The native fake answers before the first frame; the real one answers the same way.
    overrides: const [],
  );
  h.native.emitUpdate(snapshot);
  await settle(tester);
  return h;
}

void main() {
  testWidgets('updates_ready_showsBothVersionsAndInstallsOnTap', (tester) async {
    final h = await _pump(tester, _snapshot('ready'));

    expect(find.text('Ready to install'), findsOneWidget);
    expect(find.text('1.0.1 (2)'), findsOneWidget, reason: 'this app build');
    expect(find.text('1.0.2'), findsWidgets, reason: 'latest release');
    await tester.tap(find.widgetWithText(FilledButton, 'Install 1.0.2'));
    await settle(tester);

    expect(h.native.installs, 1);
    expect(find.text('Open install settings'), findsNothing, reason: 'started, no recovery needed');
  });

  testWidgets('updates_installBlockedByUnknownSources_offersSettingsThenClearsOnceAllowed', (tester) async {
    final h = await _pump(tester, _snapshot('ready', canInstall: false));
    h.native.installOutcome = InstallOutcome.needsPermission;

    await tester.tap(find.widgetWithText(FilledButton, 'Install 1.0.2'));
    await settle(tester);
    expect(find.text('Open install settings'), findsOneWidget);

    await tester.tap(find.text('Open install settings'));
    await settle(tester);
    expect(h.native.installSettingsOpens, 1);

    // Back from Android's settings with the switch on.
    h.native.emitUpdate(_snapshot('ready'));
    await settle(tester);
    expect(find.text('Open install settings'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Install 1.0.2'), findsOneWidget, reason: 'the user can retry');
  });

  testWidgets('updates_failedDownload_saysWhyAndRetriesWithAForcedCheck', (tester) async {
    final h = await _pump(tester, _snapshot('error', errorMessage: 'The download does not match its checksum.'));

    expect(find.text('Update failed'), findsOneWidget);
    expect(find.text('The download does not match its checksum.'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Install 1.0.2'), findsNothing, reason: 'nothing verified to install');

    await tester.tap(find.widgetWithText(OutlinedButton, 'Try again'));
    await settle(tester);
    expect(h.native.updateChecks.last, (baseUrl: testBaseUrl.toString(), force: true));
  });

  testWidgets('updates_downloading_showsPercentAndNoInstallButton', (tester) async {
    await _pump(tester, _snapshot('downloading', downloaded: 5 * 1024 * 1024));

    expect(find.text('Downloading 25%'), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);
  });

  testWidgets('updates_alertsOff_saysChecksHappenOnlyWhileOpen', (tester) async {
    await _pump(tester, _snapshot('current'));
    expect(find.textContaining('only looks for updates while it is open'), findsOneWidget);
  });

  test('updateState_garbageFromNative_readsAsEmptyInsteadOfThrowing', () {
    expect(AppUpdateState.fromMap(null).status, UpdateStatus.idle);
    final s = AppUpdateState.fromMap({'status': 'nonsense', 'release': {'id': 5}, 'android': {'versionCode': 'x'}, 'downloaded': 'many'});
    expect(s.status, UpdateStatus.idle);
    expect(s.release, isNull);
    expect(s.android, isNull);
    expect(s.downloaded, 0);
  });
}
