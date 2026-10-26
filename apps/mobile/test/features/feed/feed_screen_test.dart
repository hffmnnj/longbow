import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/feed/feed_screen.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'feed_test_utils.dart';

Finder _send() => find.byWidgetPredicate((w) => w is IconButton && w.tooltip == 'Send message');

bool _sendEnabled(WidgetTester tester) => tester.widget<IconButton>(_send()).onPressed != null;

/// The approvals strip scrolls inside a capped height; bring the button into view first.
Future<void> _tapButton(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
}

Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump();
}

void main() {
  group('FeedScreen states', () {
    testWidgets('beforeFirstLoad_showsSkeletonAndComposer', (tester) async {
      final h = (await tester.runAsync(StoreHarness.create))!;
      addTearDown(h.dispose);
      await pumpScreen(tester, const FeedScreen(), harness: h);

      expect(find.byType(SkeletonBlock), findsNWidgets(3));
      expect(find.text('Message the agent'), findsWidgets);
    });

    testWidgets('emptyFeed_showsMessageAndRunCycleStartsACycle', (tester) async {
      final h = await startHarness(tester, script: (api) => api.on('runCycle', () async {}));
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);

      expect(find.text('No messages yet'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Run cycle'));
      await tester.pump();
      await tester.runAsync(h.pump);

      expect(h.api.count('runCycle'), 1);
    });

    testWidgets('loadFailure_showsErrorAndRetryRefetches', (tester) async {
      final h = await startHarness(tester, script: (api) => api.fail('messages', const ApiError(500, 'boom')));
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);

      expect(find.text('Could not load the feed'), findsOneWidget);
      expect(find.text('boom'), findsOneWidget);
      final before = h.api.count('messages');

      await tester.tap(find.widgetWithText(OutlinedButton, 'Retry'));
      await tester.pump();
      await tester.runAsync(h.pump);

      expect(h.api.count('messages'), before + 1);
    });

    testWidgets('offline_showsStaleBannerAboveTheTranscript', (tester) async {
      final h = await startHarness(tester, script: (api) => api.on('messages', () async => [userMsg('u', 'hello there')]));
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);
      expect(find.byType(StaleBanner), findsNothing);

      h.events.onClose();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(StaleBanner), findsOneWidget);
      expect(find.textContaining('Offline'), findsOneWidget);
      expect(find.text('hello there'), findsOneWidget, reason: 'stale data stays visible');
    });
  });

  group('FeedScreen composer', () {
    testWidgets('send_isDisabledWhenEmptyAndSendsTrimmedText', (tester) async {
      final sent = <Object?>[];
      final gate = Completer<void>();
      final h = await startHarness(tester, script: (api) {
        api.handlers['sendMessage'] = (inv) {
          sent.add(inv.positionalArguments.first);
          return gate.future;
        };
      });
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);
      expect(_sendEnabled(tester), isFalse);

      await _type(tester, '   ');
      expect(_sendEnabled(tester), isFalse, reason: 'whitespace is empty');

      await _type(tester, '  Sell half of NVDA  ');
      expect(_sendEnabled(tester), isTrue);
      await tester.tap(_send());
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(sent, ['Sell half of NVDA']);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);
      expect(find.text('Sell half of NVDA'), findsOneWidget, reason: 'optimistic bubble');
      expect(find.text('Sending\u2026'), findsOneWidget);
      expect(_sendEnabled(tester), isFalse);

      gate.complete();
      await tester.runAsync(h.pump);
      await tester.pump(const Duration(milliseconds: 100));
    });

    testWidgets('overTheLimit_disablesSendAndShowsCounter', (tester) async {
      final h = await startHarness(tester);
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);

      await _type(tester, 'a' * 6999);
      expect(find.textContaining('/ 8000'), findsNothing);

      await _type(tester, 'a' * 7500);
      expect(find.text('7500 / 8000'), findsOneWidget);
      expect(_sendEnabled(tester), isTrue);

      await _type(tester, 'a' * 8001);
      expect(find.textContaining('8001 / 8000'), findsOneWidget);
      expect(_sendEnabled(tester), isFalse);

      await _type(tester, 'a' * 8000);
      expect(_sendEnabled(tester), isTrue, reason: '8000 is allowed');
    });

    testWidgets('failedSend_showsNotSentThenRetryResendsAndDiscardRemoves', (tester) async {
      final h = await startHarness(tester, script: (api) => api.fail('sendMessage', const ApiError(503, 'down')));
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);

      await _type(tester, 'Buy 3 NVDA');
      await tester.tap(_send());
      await tester.pump();
      await tester.runAsync(h.pump);
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Not sent'), findsOneWidget);
      expect(h.api.count('sendMessage'), 1);

      await tester.tap(find.widgetWithText(TextButton, 'Retry'));
      await tester.pump();
      await tester.runAsync(h.pump);
      await tester.pump(const Duration(milliseconds: 400));

      expect(h.api.count('sendMessage'), 2);
      expect(find.text('Not sent'), findsOneWidget, reason: 'still failing, a single failed bubble');
      expect(find.text('Buy 3 NVDA'), findsOneWidget);

      await tester.tap(find.widgetWithText(TextButton, 'Discard'));
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Not sent'), findsNothing);
      expect(find.text('Buy 3 NVDA'), findsNothing);
      expect(h.state.feed.outbox, isEmpty);
    });
  });

  group('FeedScreen approvals', () {
    testWidgets('pendingOrder_showsCardWithActionsAndCollapses', (tester) async {
      final h = await startHarness(tester, script: (api) => api.on('orders', () async => [order('ord-1', checks: const [passCheck, failCheck])]));
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);

      expect(find.text('PENDING APPROVAL'), findsOneWidget);
      expect(find.text('NVDA'), findsOneWidget);
      expect(find.text('3 @ \$501.25'), findsOneWidget);
      expect(find.text('Awaiting approval'), findsOneWidget);
      expect(find.text('Pullback to the 50-day with falling volume.'), findsOneWidget);
      expect(find.textContaining('Max spread.', findRichText: true), findsOneWidget, reason: 'failed check stays visible');
      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);

      await tester.tap(find.text('PENDING APPROVAL'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.widgetWithText(FilledButton, 'Approve'), findsNothing);
      expect(find.text('PENDING APPROVAL'), findsOneWidget, reason: 'header stays to reopen');
    });

    testWidgets('approve_showsBusyStateThenFinishes', (tester) async {
      final gate = Completer<OrderRecord?>();
      final h = await startHarness(tester, script: (api) {
        api.on('orders', () async => [order('ord-1')]);
        api.handlers['approve'] = (_) => gate.future;
      });
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);

      await _tapButton(tester, find.widgetWithText(FilledButton, 'Approve'));
      await tester.pump();
      await tester.pump();

      expect(h.api.count('approve'), 1);
      expect(find.widgetWithText(FilledButton, 'Approving\u2026'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Approving\u2026')).onPressed, isNull);
      expect(tester.widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Reject')).onPressed, isNull);

      gate.complete(null);
      await tester.runAsync(h.pump);
      await tester.pump();

      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Approve')).onPressed, isNotNull);
    });

    testWidgets('reject_asksForReasonAndSendsIt', (tester) async {
      final calls = <List<Object?>>[];
      final h = await startHarness(tester, script: (api) {
        api.on('orders', () async => [order('ord-1')]);
        api.handlers['reject'] = (inv) {
          calls.add(inv.positionalArguments);
          return Future<OrderRecord?>.value(null);
        };
      });
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);

      await _tapButton(tester, find.widgetWithText(OutlinedButton, 'Reject'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Reject order'), findsOneWidget);
      expect(h.api.count('reject'), 0, reason: 'nothing is sent before the sheet is confirmed');

      await tester.enterText(find.byType(TextField).last, '  too big for the book ');
      await _tapButton(tester, find.widgetWithText(FilledButton, 'Confirm reject'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.runAsync(h.pump);

      expect(calls, [
        ['ord-1', 'too big for the book'],
      ]);
      expect(find.text('Reject order'), findsNothing);
    });

    testWidgets('reject_cancelSendsNothing', (tester) async {
      final h = await startHarness(tester, script: (api) => api.on('orders', () async => [order('ord-1')]));
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);

      await _tapButton(tester, find.widgetWithText(OutlinedButton, 'Reject'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await _tapButton(tester, find.widgetWithText(OutlinedButton, 'Cancel'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Reject order'), findsNothing);
      expect(h.api.count('reject'), 0);
    });

    testWidgets('killSwitchEngaged_disablesApproveAndSaysWhy', (tester) async {
      final json = testStatusJson();
      (json['settings'] as Map<String, dynamic>)['killSwitch'] = true;
      final h = await startHarness(tester, script: (api) {
        api.on('status', () async => StatusResponse.fromJson(json));
        api.on('orders', () async => [order('ord-1')]);
      });
      await pumpScreen(tester, const FeedScreen(), harness: h);
      await settle(tester, h);

      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Approve')).onPressed, isNull);
      expect(tester.widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Reject')).onPressed, isNotNull);
      expect(find.text('Kill switch is engaged. Release it to approve.'), findsOneWidget);
    });
  });

  group('FeedScreen layouts', () {
    testWidgets('wide840x900_twoPanesWithApprovalsAndRecentOrdersOnTheRight', (tester) async {
      final h = await startHarness(tester, script: (api) {
        api.on('messages', () async => [userMsg('u', 'status please')]);
        api.on('orders', () async => [
              order('ord-1'),
              order('ord-2', status: OrderStatus.filled, filled: 3, fillPrice: 500, createdAt: 500),
            ]);
      });
      await pumpScreen(tester, const FeedScreen(), harness: h, size: const Size(840, 900));
      await settle(tester, h);

      final transcript = tester.getTopLeft(find.text('status please'));
      final approve = tester.getTopLeft(find.widgetWithText(FilledButton, 'Approve'));
      final recent = tester.getTopLeft(find.text('RECENT ORDERS'));
      final composer = tester.getTopLeft(find.byType(TextField));
      const paneEdge = kFeedTwoPaneWidth - kFeedSidePaneWidth;
      expect(transcript.dx, lessThan(paneEdge));
      expect(approve.dx, greaterThan(paneEdge), reason: 'approvals sit in the right pane');
      expect(recent.dx, greaterThan(paneEdge));
      expect(composer.dx, lessThan(paneEdge), reason: 'composer belongs to the transcript pane');
      expect(find.text('Filled'), findsOneWidget, reason: 'recent orders list the settled order');
      expect(tester.takeException(), isNull);
    });

    testWidgets('phone360x640_textScale2_withApprovalsAndComposerHasNoOverflow', (tester) async {
      final h = await startHarness(tester, script: (api) {
        api.on('messages', () async => [userMsg('u', 'a long question that wraps over many lines at this size'), assistantMsg('a', 'An answer', at: 2000)]);
        api.on('orders', () async => [order('ord-1', checks: const [passCheck, failCheck], review: 'Reviewer agrees.')]);
      });
      await pumpScreen(tester, const FeedScreen(), harness: h, size: const Size(360, 640), textScale: 2.0);
      await settle(tester, h);
      await _type(tester, 'line one\nline two\nline three\nline four\nline five\nline six');
      await tester.pump(const Duration(milliseconds: 300));

      expect(tester.takeException(), isNull);
      expect(_send(), findsOneWidget);
    });
  });
}
