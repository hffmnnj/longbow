import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/settings/robinhood_sign_in.dart';
import 'package:longbow/features/settings/settings_sheet.dart';
import 'package:longbow/models/models.dart';

import '../../app/app_harness.dart';

/// Scripts the harness API: status carries [json]; patchSettings records what
/// it was sent and then runs [onPatch].
class _Patches {
  final List<SettingsPatch> sent = [];
}

Future<StoreHarness> _harness({Map<String, dynamic>? statusJson, Future<Settings?> Function(SettingsPatch)? onPatch, _Patches? patches}) async {
  final h = await StoreHarness.create();
  if (statusJson != null) h.api.on('status', () async => StatusResponse.fromJson(statusJson));
  h.api.handlers['patchSettings'] = (inv) {
    final patch = inv.positionalArguments.single as SettingsPatch;
    patches?.sent.add(patch);
    return onPatch != null ? onPatch(patch) : Future<Settings?>.value();
  };
  return h;
}

Future<void> _open(WidgetTester tester, StoreHarness h, {Size size = const Size(360, 800), double textScale = 1}) async {
  await tester.runAsync(h.start);
  await pumpScreen(
    tester,
    const Scaffold(body: SettingsSheet()),
    harness: h,
    size: size,
    textScale: textScale,
  );
  await tester.pump(const Duration(milliseconds: 50));
}

/// The text field whose floating label is [label] (labels live in the decoration).
Future<void> _type(WidgetTester tester, String label, String text) async {
  final f = find.byWidgetPredicate((w) => w is TextField && w.decoration?.labelText == label);
  await _scrollTo(tester, f);
  await tester.enterText(f, text);
  // Focusing a field can scroll it into view, which pauses hit testing until it ends.
  await tester.pump(const Duration(milliseconds: 500));
}

Finder _listScrollable() => find.descendant(of: find.byType(ListView), matching: find.byType(Scrollable)).first;

/// Scrolls the settings list until [f] is fully clear of the pinned save bar.
Future<void> _scrollTo(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 200, scrollable: _listScrollable());
  await tester.ensureVisible(f);
  // A fling keeps the list ignoring pointers until it has settled.
  await tester.pump(const Duration(seconds: 1));
}

/// The Save bar's button, whatever its current label ("Save", "Save 2 changes").
Finder get _saveButton => find.byWidgetPredicate((w) => w is FilledButton && w.child is Text && (w.child as Text).data!.startsWith('Save'));
Finder _saveLabelled(String text) => find.widgetWithText(FilledButton, text);

void main() {
  testWidgets('settings_riskField_showsInlineErrorAndBlocksSave', (tester) async {
    final h = await _harness();
    await _open(tester, h);
    expect(tester.widget<FilledButton>(_saveButton).onPressed, isNull, reason: 'nothing changed yet');

    await _type(tester, 'Risk per trade', '9');
    expect(find.text('Max 5'), findsOneWidget);
    expect(tester.widget<FilledButton>(_saveButton).onPressed, isNull, reason: 'changed but invalid');

    await _type(tester, 'Risk per trade', '0');
    expect(find.text('Must be above 0'), findsOneWidget);

    await _type(tester, 'Risk per trade', '');
    expect(find.text('Required'), findsOneWidget);

    await _type(tester, 'Risk per trade', '2');
    expect(find.text('Required'), findsNothing);
    expect(find.text('Max 5'), findsNothing);
    expect(tester.widget<FilledButton>(_saveLabelled('Save 1 change')).onPressed, isNotNull);
  });

  testWidgets('settings_wholeNumberFields_rejectFractions', (tester) async {
    final h = await _harness();
    await _open(tester, h);

    await _type(tester, 'Max positions', '2.5');

    expect(find.text('Whole number'), findsOneWidget);
    expect(tester.widget<FilledButton>(_saveButton).onPressed, isNull);
  });

  testWidgets('settings_save_sendsOnlyTheChangedFields', (tester) async {
    final patches = _Patches();
    final h = await _harness(patches: patches);
    await _open(tester, h);

    await _type(tester, 'Max positions', '6');
    await _type(tester, 'Risk per trade', '2');
    await _type(tester, 'Market open', '15');
    final save = _saveLabelled('Save 3 changes');
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));

    expect(patches.sent, hasLength(1));
    expect(patches.sent.single.toJson(), {
      'cycleMinutesOpen': 15,
      'risk': {'maxRiskPerTradePct': 2.0, 'maxPositions': 6},
    });
    expect(find.text('Settings saved'), findsOneWidget);
  });

  testWidgets('settings_serverRejectionNamingAField_showsBesideThatField', (tester) async {
    final h = await _harness(onPatch: (_) async => throw const ApiError(400, 'maxPositionPct must be at most 100'));
    await _open(tester, h);

    await _type(tester, 'Max position', '50');
    final save = _saveLabelled('Save 1 change');
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));

    final error = find.text('maxPositionPct must be at most 100');
    expect(error, findsOneWidget);
    // It sits in that field's own decoration, and is not repeated in the save bar.
    expect(find.descendant(of: find.byWidgetPredicate((w) => w is TextField && w.decoration?.labelText == 'Max position'), matching: error), findsOneWidget);
    expect(tester.widget<FilledButton>(_saveLabelled('Save 1 change')).onPressed, isNotNull, reason: 'the edit is kept so it can be fixed and retried');
  });

  testWidgets('settings_serverRejectionWithoutAField_showsInSaveBar', (tester) async {
    final h = await _harness(onPatch: (_) async => throw const ApiError(400, 'Settings are locked'));
    await _open(tester, h);

    await _type(tester, 'Max positions', '5');
    await tester.tap(_saveLabelled('Save 1 change'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Settings are locked'), findsOneWidget);
    expect(find.text('Settings saved'), findsNothing);
  });

  testWidgets('settings_offline_saveShowsGenericErrorInsteadOfCrashing', (tester) async {
    final h = await _harness(onPatch: (_) async => throw StateError('Not connected'));
    await _open(tester, h);

    await _type(tester, 'Max positions', '5');
    await tester.tap(_saveLabelled('Save 1 change'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.textContaining('Could not save settings'), findsOneWidget);
  });

  testWidgets('settings_resetToDefaults_restoresDefaultRiskAndSendsOnlyThatDiff', (tester) async {
    final json = testStatusJson();
    final risk = (json['settings'] as Map<String, dynamic>)['risk'] as Map<String, dynamic>;
    risk['maxPositions'] = 7;
    risk['maxPositionPct'] = 45.0;
    final patches = _Patches();
    final h = await _harness(statusJson: json, patches: patches);
    await _open(tester, h);
    expect(tester.widget<TextField>(find.byWidgetPredicate((w) => w is TextField && w.decoration?.labelText == 'Max positions')).controller!.text, '7');

    await tester.tap(find.text('Reset to defaults'));
    await tester.pump();

    expect(tester.widget<TextField>(find.byWidgetPredicate((w) => w is TextField && w.decoration?.labelText == 'Max positions')).controller!.text, '4');
    await tester.tap(_saveLabelled('Save 2 changes'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));
    expect(patches.sent.single.toJson(), {
      'risk': {'maxPositions': 4, 'maxPositionPct': 30.0},
    });
  });

  testWidgets('settings_watchlist_addsValidTickersRejectsBadOnesAndRemoves', (tester) async {
    final patches = _Patches();
    final h = await _harness(patches: patches);
    await _open(tester, h);
    await _scrollTo(tester, find.byTooltip('Remove QQQ'));
    await tester.tap(find.byTooltip('Remove QQQ'));
    await tester.pump();
    expect(find.byKey(const ValueKey('chip-QQQ')), findsNothing);

    final add = find.byWidgetPredicate((w) => w is TextField && w.decoration?.labelText == 'Add tickers');
    await _scrollTo(tester, add);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Add')).onPressed, isNull, reason: 'nothing typed yet');
    await tester.enterText(add, 'tsla, 123, spy');
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Add')).onPressed, isNotNull, reason: 'typing enables Add');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    expect(find.byKey(const ValueKey('chip-TSLA')), findsOneWidget);
    expect(find.text('Not a ticker: 123'), findsOneWidget);
    expect(find.byKey(const ValueKey('chip-SPY')), findsOneWidget, reason: 'already listed, so no duplicate');
    expect(tester.widgetList(find.byKey(const ValueKey('chip-SPY'))), hasLength(1));

    await tester.tap(_saveLabelled('Save 1 change'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));
    final sent = patches.sent.single.watchlist!;
    expect(sent, contains('TSLA'));
    expect(sent, isNot(contains('QQQ')));
    expect(sent, hasLength(defaultSettings.watchlist.length));
  });

  testWidgets('settings_appearance_updatesThePreference', (tester) async {
    final h = await _harness();
    await _open(tester, h);
    expect(h.container.read(preferencesProvider).themeMode, AppThemeMode.dark);

    await _scrollTo(tester, find.text('Appearance'));
    await tester.tap(find.text('Light'));
    await tester.pump();

    expect(h.container.read(preferencesProvider).themeMode, AppThemeMode.light);
  });

  testWidgets('settings_robinhood_connectOpensTheSignInLinkExternallyAndRefreshesOnReturn', (tester) async {
    final opened = <Uri>[];
    final api = FakeApi()..defaults();
    api.on('connectUrl', () async => const ConnectResponse(url: 'https://auth.example.com/sign-in?s=1'));
    final h = await pumpApp(
      tester,
      const Scaffold(body: SettingsSheet()),
      api: api,
      overrides: [externalLauncherProvider.overrideWithValue((uri) async {
        opened.add(uri);
        return true;
      })],
    );

    final connect = find.widgetWithText(FilledButton, 'Connect Robinhood');
    await _scrollTo(tester, connect);
    await tester.tap(connect);
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    expect(opened, [Uri.parse('https://auth.example.com/sign-in?s=1')]);
    final statusCallsBefore = api.count('status');

    // Leaving for the browser and coming back refreshes the account status once.
    leaveAndReturn(tester);
    await tester.pump(const Duration(milliseconds: 100));
    expect(api.count('status'), statusCallsBefore + 1);
    leaveAndReturn(tester);
    await tester.pump(const Duration(milliseconds: 100));
    expect(api.count('status'), statusCallsBefore + 1, reason: 'one refresh per sign-in, not on every resume');
    expect(h.toastsSeen, isEmpty);
  });

  testWidgets('settings_robinhood_browserCannotOpen_toastsInsteadOfWaiting', (tester) async {
    final api = FakeApi()..defaults();
    api.on('connectUrl', () async => const ConnectResponse(url: 'https://auth.example.com/sign-in'));
    final h = await pumpApp(
      tester,
      const Scaffold(body: SettingsSheet()),
      api: api,
      overrides: [externalLauncherProvider.overrideWithValue((_) async => false)],
    );

    final connect = find.widgetWithText(FilledButton, 'Connect Robinhood');
    await _scrollTo(tester, connect);
    await tester.tap(connect);
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    expect(h.toastsSeen.map((t) => t.title), ['Could not open the browser']);
    final before = api.count('status');
    leaveAndReturn(tester);
    await tester.pump(const Duration(milliseconds: 100));
    expect(api.count('status'), before, reason: 'no sign-in is pending');
  });

  testWidgets('settings_notifications_enableUsesTheConnectedServerAddress', (tester) async {
    final h = await pumpApp(tester, const Scaffold(body: SettingsSheet()));
    await _scrollTo(tester, find.text('Trade alerts'));
    expect(find.textContaining('Off. Turn on'), findsOneWidget);

    await tester.tap(find.byType(Switch));
    await tester.pump(const Duration(milliseconds: 200));

    expect(h.native.enabledWith, ['https://longbow.example.ts.net:8443']);
    expect(h.container.read(preferencesProvider).notificationsEnabled, isTrue);
    expect(tester.widget<Switch>(find.byType(Switch)).value, isTrue);

    await tester.tap(find.byType(Switch));
    await tester.pump(const Duration(milliseconds: 200));
    expect(h.native.disables, 1);
    expect(h.container.read(preferencesProvider).notificationsEnabled, isFalse);
  });

  testWidgets('settings_notifications_blockedByTheSystemExplainsAndDisablesTheSwitch', (tester) async {
    final h = await pumpApp(tester, const Scaffold(body: SettingsSheet()));
    h.native.notifications = NotificationState.blocked;
    leaveAndReturn(tester);
    await tester.pump(const Duration(milliseconds: 200));
    await _scrollTo(tester, find.text('Trade alerts'));

    expect(find.textContaining('turned off for Longbow in Android'), findsOneWidget);
    expect(tester.widget<Switch>(find.byType(Switch)).onChanged, isNull);
  });

  testWidgets('settings_server_showsAddressRetriesAndChangesHost', (tester) async {
    final h = await pumpApp(tester, const Scaffold(body: SettingsSheet()));
    await _scrollTo(tester, find.text('Change host'));

    expect(find.text('https://longbow.example.ts.net:8443'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, 'Retry'));
    await tester.pump();
    expect(h.locator.retries, 1);

    await tester.tap(find.text('Change host'));
    await tester.pump(const Duration(milliseconds: 300));
    final field = find.byWidgetPredicate((w) => w is TextField && w.decoration?.labelText == 'Host or URL');
    await tester.enterText(field, 'bad host');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.widgetWithText(FilledButton, 'Use this host'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Use a host or IP, optionally with :port'), findsOneWidget);
    expect(h.locator.hosts, isEmpty);

    await tester.enterText(field, 'other.example.ts.net');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.widgetWithText(FilledButton, 'Use this host'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(h.locator.hosts, ['other.example.ts.net']);
    expect(find.widgetWithText(FilledButton, 'Use this host'), findsNothing, reason: 'the host form closes after saving');
  });

  testWidgets('settings_robinhood_disconnectNeedsConfirmation', (tester) async {
    final connected = testStatus().copyWith(broker: const BrokerStatus(state: BrokerState.connected, tools: []));
    final h = await StoreHarness.create();
    h.api.on('status', () async => connected);
    h.api.on('disconnect', () async => null);
    await _open(tester, h);

    final disconnect = find.widgetWithText(OutlinedButton, 'Disconnect');
    await _scrollTo(tester, disconnect);
    await tester.tap(disconnect);
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Disconnect Robinhood?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(h.api.count('disconnect'), 0);

    await tester.tap(disconnect);
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.widgetWithText(FilledButton, 'Disconnect'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));
    expect(h.api.count('disconnect'), 1);
  });

  testWidgets('settings_noStatusYet_stillOffersAppearanceServerAndAbout', (tester) async {
    final h = await StoreHarness.create();
    h.api.fail('status', const ApiError(0, 'Cannot reach the harness server'));
    await _open(tester, h);

    expect(find.textContaining('Settings load once the server responds'), findsOneWidget);
    expect(find.text('Risk limits'), findsNothing);
    await _scrollTo(tester, find.text('About'));
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Server'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Save'), findsNothing, reason: 'there is no form to save');
  });

  testWidgets('settings_textScale2At360x640_hasNoOverflowAndErrorsStayReadable', (tester) async {
    final h = await _harness();
    await _open(tester, h, size: const Size(360, 640), textScale: 2.0);

    await _type(tester, 'Monthly drawdown halt', '99');
    expect(find.text('Max 80'), findsOneWidget);
    await _scrollTo(tester, find.text('About'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('settings_wideSheet_laysRiskFieldsInTwoColumns', (tester) async {
    final h = await _harness();
    await _open(tester, h, size: const Size(840, 900));

    final a = tester.getTopLeft(find.byKey(const ValueKey('field-risk.maxRiskPerTradePct')));
    final b = tester.getTopLeft(find.byKey(const ValueKey('field-risk.maxPositionPct')));
    expect(b.dy, a.dy, reason: 'side by side');
    expect(b.dx, greaterThan(a.dx));
    expect(tester.takeException(), isNull);
  });

  testWidgets('settings_closeWithUnsavedEdits_asksBeforeDiscarding', (tester) async {
    await pumpApp(
      tester,
      Builder(builder: (context) => Scaffold(body: Center(child: TextButton(onPressed: () => showSettingsSheet(context), child: const Text('Open settings'))))),
    );
    await tester.tap(find.text('Open settings'));
    await settle(tester, 12);
    expect(find.text('Risk limits'), findsOneWidget);

    // Clean form closes without a prompt.
    await tester.tap(find.byTooltip('Close'));
    await settle(tester, 12);
    expect(find.text('Risk limits'), findsNothing);
    expect(find.text('Discard changes?'), findsNothing);

    await tester.tap(find.text('Open settings'));
    await settle(tester, 12);
    await _type(tester, 'Max positions', '9');
    await tester.drag(find.byType(ListView), const Offset(0, 4000));
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(find.byTooltip('Close'));
    await settle(tester, 6);
    expect(find.text('Discard changes?'), findsOneWidget);

    await tester.tap(find.text('Keep editing'));
    await settle(tester, 6);
    expect(find.text('Risk limits'), findsOneWidget, reason: 'the sheet is still open with the edit');

    await tester.tap(find.byTooltip('Close'));
    await settle(tester, 6);
    await tester.tap(find.widgetWithText(FilledButton, 'Discard'));
    await settle(tester, 12);
    expect(find.text('Risk limits'), findsNothing);
  });
}
