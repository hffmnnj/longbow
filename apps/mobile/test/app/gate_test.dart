import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/app/gate.dart';
import 'package:longbow/app/shell.dart';
import 'package:longbow/data/data.dart';

import 'app_harness.dart';

Finder get _retry => find.widgetWithText(FilledButton, 'Retry');

void main() {
  testWidgets('gate_searching_showsSplashMarkAndNoForm', (tester) async {
    await pumpApp(tester, const ConnectionGate(), locatorState: const Searching());

    expect(find.bySemanticsLabel('Longbow'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.text('Connect to Longbow'), findsNothing);
    expect(find.byType(AppShell), findsNothing);
  });

  testWidgets('gate_noHosts_explainsTailscaleAndRejectsABadHost', (tester) async {
    final h = await pumpApp(tester, const ConnectionGate(), locatorState: const NoHosts());

    expect(find.text('Connect to Longbow'), findsOneWidget);
    expect(find.textContaining('Tailscale'), findsOneWidget);
    final connect = find.widgetWithText(FilledButton, 'Connect');
    expect(tester.widget<FilledButton>(connect).onPressed, isNull, reason: 'empty field cannot submit');

    await tester.enterText(find.byType(TextField), 'bad host');
    await tester.pump();
    await tester.tap(connect);
    await settle(tester);
    expect(find.text('Use a host or IP, optionally with :port'), findsOneWidget);
    expect(h.locator.hosts, isEmpty);

    await tester.enterText(find.byType(TextField), '  Longbow.Example.ts.net ');
    await tester.pump();
    expect(find.text('Use a host or IP, optionally with :port'), findsNothing);
    await tester.tap(connect);
    await settle(tester);
    expect(h.locator.hosts, ['longbow.example.ts.net']);
  });

  testWidgets('gate_unreachable_listsWhatWasTriedAndRetries', (tester) async {
    final h = await pumpApp(
      tester,
      const ConnectionGate(),
      locatorState: const Unreachable(['https://longbow.example.ts.net:8443', 'http://100.101.102.103:4520'], true),
    );

    expect(find.text("Can't reach Longbow"), findsOneWidget);
    expect(find.textContaining('Tailscale is connected'), findsOneWidget);
    await tester.tap(find.text('What was tried'));
    await settle(tester);
    expect(find.text('https://longbow.example.ts.net:8443'), findsOneWidget);
    expect(find.text('http://100.101.102.103:4520'), findsOneWidget);

    await tester.tap(_retry);
    await tester.pump();
    expect(h.locator.retries, 1);
  });

  testWidgets('gate_unreachable_openTailscaleSaysWhenItIsNotInstalled', (tester) async {
    final h = await pumpApp(tester, const ConnectionGate(), locatorState: const Unreachable(['https://longbow.example.ts.net:8443'], true));
    expect(find.textContaining('not installed'), findsNothing);

    h.native.tailscaleResult = true;
    await tester.tap(find.widgetWithText(OutlinedButton, 'Open Tailscale'));
    await settle(tester);
    expect(h.native.tailscaleOpens, 1);
    expect(find.textContaining('not installed'), findsNothing, reason: 'the app opened');

    h.native.tailscaleResult = false;
    await tester.tap(find.widgetWithText(OutlinedButton, 'Open Tailscale'));
    await settle(tester);
    expect(h.native.tailscaleOpens, 2);
    expect(find.textContaining('Tailscale is not installed'), findsOneWidget);
  });

  testWidgets('gate_unreachable_advancedHostFieldSavesTheHost', (tester) async {
    final h = await pumpApp(tester, const ConnectionGate(), locatorState: const Unreachable(['https://longbow.example.ts.net:8443'], false));
    expect(find.textContaining('did not answer'), findsOneWidget, reason: 'not Tailscale-flavored when no tailnet address was tried');

    await tester.ensureVisible(find.text('Advanced'));
    await tester.tap(find.text('Advanced'));
    await settle(tester);
    await tester.enterText(find.byType(TextField), '100.101.102.103:4520');
    await tester.pump();
    final use = find.widgetWithText(FilledButton, 'Use this host');
    await tester.ensureVisible(use);
    await tester.tap(use);
    await settle(tester);
    expect(h.locator.hosts, ['100.101.102.103:4520']);
  });

  testWidgets('gate_retryProbe_keepsTheExplanationInsteadOfFlashingTheSplash', (tester) async {
    final h = await pumpApp(tester, const ConnectionGate(), locatorState: const Unreachable(['https://longbow.example.ts.net:8443'], true));

    h.locator.set(const Searching());
    await settle(tester);

    expect(find.text("Can't reach Longbow"), findsOneWidget);
    expect(find.text('Trying\u2026'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Trying\u2026')).onPressed, isNull);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
  });

  testWidgets('gate_connected_showsTheShell', (tester) async {
    await pumpApp(tester, const ConnectionGate());

    expect(find.byType(AppShell), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.text('Connect to Longbow'), findsNothing);
  });

  testWidgets('gate_connectionDropsAfterConnecting_staysInTheShellWithOfflineStrip', (tester) async {
    final h = await pumpApp(tester, const ConnectionGate());
    expect(find.textContaining('Offline'), findsNothing);

    h.locator.set(const Searching());
    await settle(tester);
    h.locator.set(const Unreachable(['https://longbow.example.ts.net:8443'], true));
    await settle(tester);

    expect(find.byType(AppShell), findsOneWidget);
    expect(find.text("Can't reach Longbow"), findsNothing);
    expect(find.textContaining('Offline'), findsOneWidget);
    expect(find.text('Feed body'), findsOneWidget, reason: 'the tab content stays on screen');
  });
}
