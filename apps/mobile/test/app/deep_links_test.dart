import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/app/deep_link_queue.dart';
import 'package:longbow/app/gate.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/feed/order_sheet.dart';
import 'package:longbow/features/history/history_screen.dart';
import 'package:longbow/features/reports/report_page.dart';
import 'package:longbow/features/reports/reports_screen.dart';
import 'package:longbow/models/models.dart';

import 'app_harness.dart';

void main() {
  testWidgets('deepLink_coldStartReport_waitsForTheShellThenOpensTheReport', (tester) async {
    final api = FakeApi()..defaults();
    final h = await _pump(tester, api: api, locatorState: const Searching(), initial: '/?report=rep-42');
    expect(find.byType(ReportPage), findsNothing, reason: 'still connecting, no shell yet');

    h.locator.set(Connected(testBaseUrl));
    await settle(tester, 20);

    final page = tester.widget<ReportPage>(find.byType(ReportPage));
    expect(page.id, 'rep-42');
    expect(h.container.read(deepLinkQueueProvider), isEmpty, reason: 'the queue is drained');
  });

  testWidgets('deepLink_order_opensTheOrderSheetForThatId', (tester) async {
    final api = FakeApi()
      ..defaults()
      ..on('orders', () async => [testOrder('ord-7')]);
    final h = await _pump(tester, api: api);

    h.native.emit('https://longbow.example.ts.net:8443/?order=ord-7');
    await settle(tester, 12);

    expect(tester.widget<OrderSheetBody>(find.byType(OrderSheetBody)).orderId, 'ord-7');
  });

  testWidgets('deepLink_sectionTab_selectsThatTab', (tester) async {
    final h = await _pump(tester);
    expect(find.text('Feed body'), findsOneWidget);

    h.native.emit('/?view=markets');
    await settle(tester, 12);

    expect(find.text('Markets body'), findsOneWidget);
    expect(find.text('Feed body'), findsNothing);
  });

  testWidgets('deepLink_liveAlias_goesToFeed', (tester) async {
    final h = await _pump(tester);
    h.native.emit('/?view=agent');
    await settle(tester, 12);
    expect(find.text('Agent body'), findsOneWidget);

    h.native.emit('/?view=live');
    await settle(tester, 12);

    expect(find.text('Feed body'), findsOneWidget);
  });

  testWidgets('deepLink_sectionPages_pushReportsAndJournal', (tester) async {
    final h = await _pump(tester);

    h.native.emit('/?view=reports');
    await settle(tester, 20);
    expect(find.byType(ReportsScreen), findsOneWidget);

    h.native.emit('/?view=history');
    await settle(tester, 20);
    expect(find.byType(HistoryScreen), findsOneWidget);
    expect(find.byType(ReportsScreen), findsNothing, reason: 'the first page was popped, not stacked under');
  });

  testWidgets('deepLink_tabWhilePageIsOpen_popsBackToTheShellFirst', (tester) async {
    final h = await _pump(tester);
    h.native.emit('/?view=history');
    await settle(tester, 20);
    expect(find.byType(HistoryScreen), findsOneWidget);

    h.native.emit('/?view=performance');
    await settle(tester, 20);

    expect(find.byType(HistoryScreen), findsNothing);
    expect(find.text('Performance body'), findsOneWidget);
  });

  testWidgets('deepLink_kill_confirmThenEngagesWithHeavyHaptic', (tester) async {
    final log = recordPlatform(tester);
    SettingsPatch? sent;
    final api = FakeApi()..defaults();
    api.handlers['patchSettings'] = (inv) {
      sent = inv.positionalArguments.single as SettingsPatch;
      return Future<Settings?>.value();
    };
    final h = await _pump(tester, api: api);

    h.native.emit('/?action=kill');
    await settle(tester, 12);
    expect(find.text('Engage the kill switch?'), findsOneWidget);
    expect(sent, isNull, reason: 'nothing happens before the user confirms');

    await tester.tap(find.widgetWithText(FilledButton, 'Engage kill switch'));
    await settle(tester, 12);

    expect(sent?.toJson(), {'killSwitch': true});
    expect(log.haptics, ['HapticFeedbackType.heavyImpact']);
  });

  testWidgets('deepLink_kill_cancelLeavesTheSwitchAlone', (tester) async {
    final log = recordPlatform(tester);
    final api = FakeApi()..defaults();
    var patched = false;
    api.handlers['patchSettings'] = (_) {
      patched = true;
      return Future<Settings?>.value();
    };
    final h = await _pump(tester, api: api);

    h.native.emit('/?action=kill');
    await settle(tester, 12);
    await tester.tap(find.text('Cancel'));
    await settle(tester, 12);

    expect(patched, isFalse);
    expect(log.haptics, isEmpty);
    expect(find.text('Engage the kill switch?'), findsNothing);
  });

  testWidgets('deepLink_kill_whenAlreadyEngagedOnlyTellsYou', (tester) async {
    final json = testStatusJson();
    (json['settings'] as Map<String, dynamic>)['killSwitch'] = true;
    final api = FakeApi()
      ..defaults()
      ..on('status', () async => StatusResponse.fromJson(json));
    final h = await _pump(tester, api: api);

    h.native.emit('/?action=kill');
    await settle(tester, 12);

    expect(find.text('Engage the kill switch?'), findsNothing);
    expect(find.text('Kill switch is already engaged'), findsOneWidget);
  });

  testWidgets('deepLink_foreignOrUnknownLinks_doNothing', (tester) async {
    final h = await _pump(tester);

    for (final url in ['javascript:alert(1)', '/?view=nonsense', '/', 'mailto:a@example.com?order=1']) {
      h.native.emit(url);
      await settle(tester, 6);
    }

    expect(find.text('Feed body'), findsOneWidget);
    expect(find.byType(Dialog), findsNothing);
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.byType(ReportPage), findsNothing);
  });
}

Future<AppHarness> _pump(
  WidgetTester tester, {
  FakeApi? api,
  LocatorState? locatorState,
  String? initial,
}) async {
  // The initial link must be set before the gate reads it, so seed it through
  // a fake that is installed before the first frame.
  return pumpApp(tester, const ConnectionGate(), api: api, locatorState: locatorState, initialLink: initial);
}
