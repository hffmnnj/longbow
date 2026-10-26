import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/app/shell.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/history/history_screen.dart';
import 'package:longbow/features/reports/reports_screen.dart';
import 'package:longbow/features/settings/settings_sheet.dart';
import 'package:longbow/models/models.dart';

import 'app_harness.dart';

FakeApi _apiWith({StatusResponse? status, List<OrderRecord> orders = const []}) {
  final api = FakeApi()..defaults();
  if (status != null) api.on('status', () async => status);
  api.on('orders', () async => orders);
  return api;
}

Finder get _bar => find.byType(NavigationBar);

void main() {
  testWidgets('shell_tabTap_switchesBodyKeepsVisitedTabsAndFiresOneSelectionHaptic', (tester) async {
    final log = recordPlatform(tester);
    final haptics = log.haptics;
    await pumpApp(tester, const AppShell());
    expect(find.text('Feed body'), findsOneWidget);
    expect(find.text('Portfolio body'), findsNothing, reason: 'unvisited tabs are not built');

    await tester.tap(find.descendant(of: _bar, matching: find.text('Portfolio')));
    await settle(tester);
    expect(find.text('Portfolio body'), findsOneWidget);
    expect(find.text('Feed body'), findsNothing, reason: 'the old tab fades out and goes offstage');
    expect(find.text('Feed body', skipOffstage: false), findsOneWidget, reason: 'but stays alive');
    expect(haptics, ['HapticFeedbackType.selectionClick']);

    await tester.tap(find.descendant(of: _bar, matching: find.text('Portfolio')));
    await settle(tester);
    expect(haptics, hasLength(1), reason: 'reselecting the current tab is not a change');

    await tester.tap(find.descendant(of: _bar, matching: find.text('Feed')));
    await settle(tester);
    expect(find.text('Feed body'), findsOneWidget);
    expect(find.text('Portfolio body'), findsNothing);
    expect(haptics, hasLength(2));
  });

  testWidgets('shell_pendingApprovals_badgeCountsOnlyOrdersWaitingForYou', (tester) async {
    final api = _apiWith(orders: [
      testOrder('a'),
      testOrder('b'),
      testOrder('c', status: OrderStatus.failed),
    ]);
    await pumpApp(tester, const AppShell(), api: api);

    final badge = find.descendant(of: _bar, matching: find.byType(Badge));
    expect(badge, findsOneWidget);
    expect(tester.widget<Badge>(badge).isLabelVisible, isTrue);
    expect(find.descendant(of: badge, matching: find.text('2')), findsOneWidget);
  });

  testWidgets('shell_noPendingOrders_hidesTheBadge', (tester) async {
    await pumpApp(tester, const AppShell(), api: _apiWith(orders: [testOrder('c', status: OrderStatus.failed)]));

    final badge = find.descendant(of: _bar, matching: find.byType(Badge));
    expect(tester.widget<Badge>(badge).isLabelVisible, isFalse);
  });

  testWidgets('shell_header_showsEquityDayPnlAndStatusPills', (tester) async {
    final status = testStatus(agentState: AgentState.running, dayPnl: 42.5);
    await pumpApp(tester, const AppShell(), api: _apiWith(status: status));

    expect(find.text(r'$1,200.00'), findsOneWidget);
    expect(find.text(r'+$42.50'), findsOneWidget);
    expect(find.text('Agent working'), findsOneWidget);
    expect(find.textContaining('Market closed'), findsOneWidget);
    expect(find.text('Robinhood not connected'), findsOneWidget, reason: 'a broker problem earns a pill');
    expect(find.text('Mode Auto'), findsOneWidget);
  });

  testWidgets('shell_statusPills_openTheDetailSheetWithAgentRunNow', (tester) async {
    final api = _apiWith();
    api.on('runCycle', () async => null);
    await pumpApp(tester, const AppShell(), api: api);

    await tester.tap(find.bySemanticsLabel('Status details'));
    await settle(tester);

    expect(find.text('Status'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, 'Run now'));
    await settle(tester);
    expect(api.count('runCycle'), 1);
  });

  testWidgets('shell_haltBanner_usesPlainWordsForEveryReason', (tester) async {
    final status = testStatus(halts: [HaltReason.killSwitch, HaltReason.dailyLoss, HaltReason.brokerDisconnected]);
    await pumpApp(tester, const AppShell(), api: _apiWith(status: status));

    expect(find.text('Kill switch is engaged. No orders will be placed.'), findsOneWidget);
    expect(find.text('Daily loss limit reached. New entries are paused until the next session.'), findsOneWidget);
    expect(find.text('Robinhood is not connected. Nothing can trade.'), findsOneWidget);
    expect(find.text('Re-arm'), findsNothing, reason: 'only a drawdown halt can be re-armed');
  });

  testWidgets('shell_noHalts_showsNoBanner', (tester) async {
    await pumpApp(tester, const AppShell());

    expect(find.textContaining('Kill switch is engaged'), findsNothing);
    expect(find.textContaining('limit reached'), findsNothing);
  });

  testWidgets('shell_drawdownHalt_rearmNeedsConfirmationThenClearsTheHalt', (tester) async {
    final api = _apiWith(status: testStatus(halts: [HaltReason.drawdown]));
    SettingsPatch? sent;
    api.handlers['patchSettings'] = (inv) {
      sent = inv.positionalArguments.single as SettingsPatch;
      return Future<Settings?>.value();
    };
    await pumpApp(tester, const AppShell(), api: api);
    expect(find.text('Monthly drawdown limit reached. New entries stay halted until you re-arm.'), findsOneWidget);

    await tester.tap(find.text('Re-arm'));
    await settle(tester);
    expect(find.text('Re-arm after drawdown halt?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    expect(sent, isNull);

    await tester.tap(find.text('Re-arm'));
    await settle(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Re-arm'));
    await settle(tester);
    expect(sent?.drawdownHalted, isFalse);
    expect(sent?.toJson(), {'drawdownHalted': false}, reason: 'nothing else is changed');
  });

  testWidgets('shell_streamDrops_offlineStripShowsAgeOfLastKnownAccount', (tester) async {
    final fourMinutesAgo = DateTime.now().millisecondsSinceEpoch - 4 * 60 * 1000;
    final h = await pumpApp(
      tester,
      const AppShell(),
      prefs: {
        'status.cache': jsonEncode({'at': fourMinutesAgo, 'status': testStatusJson(agentState: 'idle')}),
      },
      api: FakeApi()
        ..defaults()
        ..fail('status', const ApiError(0, 'Cannot reach the harness server')),
    );
    expect(find.textContaining('Offline'), findsNothing);

    h.events.onClose();
    await settle(tester);

    expect(find.text('Offline \u00b7 updated 4m ago'), findsOneWidget);
    expect(find.text(r'$1,200.00'), findsOneWidget, reason: 'the saved account stays visible');
  });

  testWidgets('shell_toast_withReportIdOpensTheReportFromItsAction', (tester) async {
    final h = await pumpApp(tester, const AppShell());

    h.toast(const ToastEvent(tone: ToastTone.success, title: 'Daily report ready', body: 'Quiet day', actionLabel: 'Open', reportId: 'rep-1'));
    await settle(tester);
    expect(find.textContaining('Daily report ready'), findsOneWidget);
    expect(find.textContaining('Quiet day'), findsOneWidget);

    await tester.tap(find.text('Open'));
    await settle(tester);
    expect(find.byType(AppShell), findsOneWidget);
    expect(find.text('Daily report ready'), findsNothing, reason: 'the snack bar is dismissed by its action');
    expect(find.byType(Scaffold), findsWidgets);
    await settle(tester, 20);
    expect(find.byType(NavigationBar), findsNothing, reason: 'the report page covers the shell');
  });

  testWidgets('shell_toast_plainErrorHasNoAction', (tester) async {
    final h = await pumpApp(tester, const AppShell());

    h.toast(const ToastEvent(tone: ToastTone.error, title: 'Could not approve the order', body: 'Cannot reach the harness server'));
    await settle(tester);

    expect(find.textContaining('Could not approve the order'), findsOneWidget);
    expect(find.byType(SnackBarAction), findsNothing);
  });

  testWidgets('shell_moreMenu_listsDestinationsAndPushesReports', (tester) async {
    await pumpApp(tester, const AppShell());

    await tester.tap(find.byTooltip('More'));
    await settle(tester);
    for (final label in ['Reports', 'Journal and orders', 'Lab', 'Settings']) {
      expect(find.widgetWithText(ListTile, label), findsOneWidget);
    }

    await tester.tap(find.widgetWithText(ListTile, 'Reports'));
    await settle(tester, 20);
    expect(find.byType(ReportsScreen), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });

  testWidgets('shell_moreMenu_settingsOpensTheSettingsSheet', (tester) async {
    await pumpApp(tester, const AppShell());

    await tester.tap(find.byTooltip('More'));
    await settle(tester);
    await tester.tap(find.widgetWithText(ListTile, 'Settings'));
    await settle(tester);

    expect(find.text('Risk limits'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Appearance'), 300, scrollable: find.descendant(of: find.byType(SettingsSheet), matching: find.byType(Scrollable)).first);
    expect(find.text('Appearance'), findsOneWidget);
  });

  testWidgets('shell_back_closesSheetThenReturnsToFeedThenLeaves', (tester) async {
    final log = recordPlatform(tester);
    await pumpApp(tester, const AppShell());
    await tester.tap(find.descendant(of: _bar, matching: find.text('Markets')));
    await settle(tester);
    expect(find.text('Markets body'), findsOneWidget);

    // Back closes an open sheet first.
    await tester.tap(find.byTooltip('More'));
    await settle(tester);
    expect(find.widgetWithText(ListTile, 'Lab'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await settle(tester);
    expect(find.widgetWithText(ListTile, 'Lab'), findsNothing);
    expect(find.text('Markets body'), findsOneWidget, reason: 'the sheet took the back press, not the tab');

    // Then a pushed page.
    await tester.tap(find.byTooltip('More'));
    await settle(tester);
    await tester.tap(find.widgetWithText(ListTile, 'Journal and orders'));
    await settle(tester);
    expect(find.byType(HistoryScreen), findsOneWidget);
    await tester.binding.handlePopRoute();
    await settle(tester, 20);
    expect(find.byType(HistoryScreen), findsNothing);
    expect(find.text('Markets body'), findsOneWidget);

    // Then the tab: back goes to Feed.
    await tester.binding.handlePopRoute();
    await settle(tester);
    expect(find.text('Feed body'), findsOneWidget);
    expect(find.text('Markets body'), findsNothing);

    // On Feed the shell lets the system leave the app.
    expect(log.exits, 0);
    await tester.binding.handlePopRoute();
    await settle(tester);
    expect(log.exits, 1, reason: 'nothing left to unwind, so the app asks the system to leave');
  });

  testWidgets('shell_phoneWidth_usesBottomBarWithFiveDestinations', (tester) async {
    await pumpApp(tester, const AppShell());

    expect(_bar, findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
    expect(tester.widget<NavigationBar>(_bar).destinations.map((d) => (d as NavigationDestination).label), ['Feed', 'Portfolio', 'Markets', 'Performance', 'Agent']);
  });

  testWidgets('shell_tabletWidth_usesRailAndNoBottomBar', (tester) async {
    await pumpApp(tester, const AppShell(), size: const Size(840, 900));

    expect(find.byType(NavigationRail), findsOneWidget);
    expect(_bar, findsNothing);
    expect(tester.widget<NavigationRail>(find.byType(NavigationRail)).extended, isTrue);
    await tester.tap(find.descendant(of: find.byType(NavigationRail), matching: find.text('Agent')));
    await settle(tester);
    expect(find.text('Agent body'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shell_mediumWidth_railShowsLabelsWithoutExtending', (tester) async {
    await pumpApp(tester, const AppShell(), size: const Size(700, 900));

    final rail = tester.widget<NavigationRail>(find.byType(NavigationRail));
    expect(rail.extended, isFalse);
    expect(rail.labelType, NavigationRailLabelType.all);
  });

  testWidgets('shell_textScale2At360x640_hasNoOverflowAndKeepsEveryTarget', (tester) async {
    final status = testStatus(agentState: AgentState.running, dayPnl: -1234.56, halts: [HaltReason.dailyLoss, HaltReason.drawdown]);
    await pumpApp(tester, const AppShell(), api: _apiWith(status: status, orders: [testOrder('a')]), size: const Size(360, 640), textScale: 2.0);

    expect(tester.takeException(), isNull);
    for (final tooltip in ['Jump to', 'Settings', 'More']) {
      final size = tester.getSize(find.byTooltip(tooltip));
      expect(size.width, greaterThanOrEqualTo(48), reason: '$tooltip width');
      expect(size.height, greaterThanOrEqualTo(48), reason: '$tooltip height');
    }
    // The pill row is taller than the scrolling header box at this size, so aim at its top edge.
    await tester.ensureVisible(find.bySemanticsLabel('Status details'));
    await tester.tapAt(tester.getTopLeft(find.bySemanticsLabel('Status details')) + const Offset(6, 6));
    await settle(tester);
    expect(find.text('Status'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shell_keyboardUp_dropsPillRowAndBottomBar', (tester) async {
    await pumpApp(tester, const AppShell());
    expect(_bar, findsOneWidget);

    tester.view.viewInsets = const FakeViewPadding(bottom: 900);
    addTearDown(tester.view.resetViewInsets);
    await settle(tester);

    expect(_bar, findsNothing);
    expect(find.bySemanticsLabel('Status details'), findsNothing);
    expect(find.text(r'$1,200.00'), findsOneWidget, reason: 'the verdict stays');
  });
}
