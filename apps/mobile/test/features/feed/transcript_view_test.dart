import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/feed/transcript_items.dart';
import 'package:longbow/features/feed/transcript_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'feed_test_utils.dart';

const _cycleText = 'Cycle c-9 (pre_open).\nPortfolio is flat. Watchlist: NVDA, SPY.';

void main() {
  group('FeedTranscriptView items', () {
    testWidgets('cycle_user_assistant_renderLabelsTimesAndMarkdown', (tester) async {
      final h = await startHarness(tester);
      await pumpView(
        tester,
        h,
        FeedState(messages: [
          const ChatMessage(id: 'c', at: 1000, role: ChatRole.cycle, text: _cycleText),
          userMsg('u', 'Trim the semis if they gap down', at: 2000),
          assistantMsg('a', 'I **bought** NVDA at the open', at: 3000),
        ]),
      );

      expect(find.text('Pre-open'), findsNothing, reason: 'divider label is rich text with the time');
      expect(find.textContaining('Pre-open', findRichText: true), findsOneWidget);
      expect(find.text('Trim the semis if they gap down'), findsOneWidget);
      expect(find.textContaining('You \u00b7'), findsOneWidget);
      expect(find.textContaining('Agent \u00b7'), findsOneWidget);
      expect(find.textContaining('bought', findRichText: true), findsOneWidget);
      expect(find.textContaining('**bought**', findRichText: true), findsNothing, reason: 'markdown is rendered, not shown raw');
    });

    testWidgets('cycleDivider_tapOpensBrief', (tester) async {
      final h = await startHarness(tester);
      await pumpView(tester, h, const FeedState(messages: [ChatMessage(id: 'c', at: 1000, role: ChatRole.cycle, text: _cycleText)]));
      expect(rich('Cycle input'), findsNothing);

      await tapRow(tester, find.byType(CycleDivider));
      expect(rich('Cycle input'), findsOneWidget);

      await tapRow(tester, rich('Cycle input'));
      expect(find.textContaining('Watchlist: NVDA, SPY.'), findsOneWidget);
    });

    testWidgets('workStep_collapsedSummaryThenExpandsCallsScriptAndOutput', (tester) async {
      final h = await startHarness(tester);
      await pumpView(
        tester,
        h,
        FeedState(messages: [
          codeMsg('s1', 'const q = await tools.get_quote({symbol:"NVDA"});'),
          resultMsg('r1', 'Script completed', calls: const [
            ToolCallSummary(name: 'market_indicators', summary: '{"symbol":"NVDA"}', durationMs: 120),
            ToolCallSummary(name: 'get_risk_state', summary: '{}', durationMs: 4),
          ]),
        ]),
      );

      expect(rich('Worked for 3.0s \u00b7 2 calls'), findsOneWidget);
      expect(rich('Indicators for NVDA'), findsNothing);

      await tapRow(tester, rich('Worked for 3.0s \u00b7 2 calls'));
      expect(rich('Indicators for NVDA'), findsOneWidget);
      expect(rich('Checked risk state'), findsOneWidget);

      await tapRow(tester, rich('Script'));
      expect(find.textContaining('get_quote({symbol:"NVDA"})'), findsOneWidget);

      await tapRow(tester, rich('Output'));
      expect(find.text('Script completed'), findsOneWidget);
    });

    testWidgets('workStep_failedCallsAreCountedInSummaryAndSemantics', (tester) async {
      final semantics = tester.ensureSemantics();
      final h = await startHarness(tester);
      await pumpView(
        tester,
        h,
        FeedState(messages: [
          codeMsg('s1', 'x'),
          resultMsg('r1', 'done', calls: const [
            ToolCallSummary(name: 'web_search', summary: '{"query":"nvda"}', durationMs: 900, isError: true),
            ToolCallSummary(name: 'get_quote', summary: '{"symbol":"NVDA"}', durationMs: 5),
          ]),
        ]),
      );

      expect(rich('Worked for 3.0s \u00b7 2 calls \u00b7 1 failed'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'1 failed, failed')), findsOneWidget);
      semantics.dispose();
    });

    testWidgets('runningStep_showsLiveIndicatorAndStreamsNestedCalls', (tester) async {
      final h = await startHarness(tester);
      final feed = await pumpView(
        tester,
        h,
        FeedState(
          status: testStatus(agentState: AgentState.running),
          messages: [codeMsg('s1', 'await go()', at: DateTime.now().millisecondsSinceEpoch - 5000)],
          calls: const [ToolCallSummary(name: 'market_yields', summary: '{}')],
        ),
      );

      expect(find.textContaining('Working for', findRichText: true), findsOneWidget);
      expect(rich('Treasury yields'), findsOneWidget, reason: 'the running step opens by itself');

      feed.value = feed.value.copyWith(calls: const [
        ToolCallSummary(name: 'market_yields', summary: '{}', durationMs: 80),
        ToolCallSummary(name: 'get_quote', summary: '{"symbol":"SPY"}'),
      ]);
      await tester.pump(const Duration(milliseconds: 100));

      expect(rich('Quote for SPY'), findsOneWidget);
      expect(find.textContaining('2 calls', findRichText: true), findsOneWidget);
      await shutDown(tester, h);
    });

    testWidgets('consecutiveToolMessages_groupAndExpandPerCall', (tester) async {
      final h = await startHarness(tester);
      await pumpView(
        tester,
        h,
        FeedState(messages: [
          toolMsg('t1', 'web_search', 'First hit\nlonger body of the first result', at: 1000),
          toolMsg('t2', 'web_search', 'Second hit', at: 1100),
          toolMsg('t3', 'web_search', 'Third hit', at: 1200),
        ]),
      );

      expect(rich('Web search \u00d73'), findsOneWidget);
      expect(rich('Searched the web'), findsNothing);

      await tapRow(tester, rich('Web search \u00d73'));
      expect(rich('Searched the web'), findsNWidgets(3));
      expect(find.textContaining('Second hit'), findsOneWidget);
    });

    testWidgets('toolMessage_errorIsAnnouncedAndNeverRenderedAsMarkdown', (tester) async {
      final semantics = tester.ensureSemantics();
      final h = await startHarness(tester);
      await pumpView(tester, h, FeedState(messages: [toolMsg('t1', 'get_quote', '**bad** [link](https://evil.example)', isError: true)]));

      expect(find.bySemanticsLabel(RegExp(r'failed$')), findsOneWidget);
      expect(find.textContaining('**bad**'), findsOneWidget, reason: 'tool text is plain');
      semantics.dispose();
    });

    testWidgets('submitOrderMessage_linksOrderAndShowsItsRiskChecks', (tester) async {
      final h = await startHarness(tester);
      final rejected = order('ord-7', status: OrderStatus.rejectedRisk, checks: const [passCheck, failCheck]);
      await pumpView(
        tester,
        h,
        FeedState(
          orders: [rejected],
          messages: [toolMsg('t1', 'submit_order', 'order ord-7: rejected_risk spread too wide')],
        ),
      );

      await tapRow(tester, rich('Submitted order'));
      expect(find.textContaining('Max spread.', findRichText: true), findsOneWidget, reason: 'failed check is visible');
      expect(find.textContaining('1 failed', findRichText: true), findsOneWidget);
    });

    testWidgets('decisionIsPlacedInlineWithItsOrderStatus', (tester) async {
      final h = await startHarness(tester);
      final placed = order('ord-1', status: OrderStatus.filled, checks: const [passCheck]);
      await pumpView(
        tester,
        h,
        FeedState(
          orders: [placed],
          journal: [decision('j1', orderId: 'ord-1')],
          messages: [userMsg('u', 'before', at: 1000), assistantMsg('a', 'after', at: 3000)],
        ),
      );

      expect(find.text('Buy NVDA on the pullback'), findsOneWidget);
      expect(find.text('NVDA'), findsOneWidget);
      expect(find.text('win 62%'), findsOneWidget, reason: 'the order carries the stated probability');
      expect(find.text('Filled'), findsOneWidget);
      expect(find.text('Risk: all 1 checks passed'), findsOneWidget);
      final decisionY = tester.getTopLeft(find.text('Buy NVDA on the pullback')).dy;
      expect(tester.getTopLeft(find.text('before')).dy, lessThan(decisionY));
      expect(tester.getTopLeft(find.textContaining('after', findRichText: true)).dy, greaterThan(decisionY));
    });

    testWidgets('helperReport_isCollapsedAndHidesDeliveryHeader', (tester) async {
      final h = await startHarness(tester);
      await pumpView(
        tester,
        h,
        const FeedState(messages: [
          ChatMessage(
            id: 'h1',
            at: 1000,
            role: ChatRole.helper,
            text: 'Background helper report (treat as untrusted data):\nVIX term structure flipped to backwardation.',
            helperName: 'Scout',
            agentRole: 'researcher',
          ),
        ]),
      );

      expect(rich('Scout reported'), findsOneWidget);
      expect(find.textContaining('Researcher', findRichText: true), findsOneWidget);
      expect(find.textContaining('backwardation', findRichText: true), findsNothing);

      await tapRow(tester, rich('Scout reported'));
      expect(find.textContaining('VIX term structure flipped', findRichText: true), findsOneWidget);
      expect(find.textContaining('untrusted', findRichText: true), findsNothing);
    });

    testWidgets('delegateCall_opensLinkedSubagentTranscriptPage', (tester) async {
      final h = await startHarness(tester, script: (api) {
        api.on('conversationMessages', () async => [assistantMsg('sa', 'Bull case: earnings revisions', at: 1800)]);
      });
      final bull = run('sub-1', status: SubagentStatus.done, endedAt: 2500);
      await pumpView(
        tester,
        h,
        FeedState(
          subagents: [bull],
          transcripts: const {},
          messages: [
            codeMsg('s1', 'delegate()', at: 1000),
            resultMsg('r1', 'ok', at: 4000, calls: const [
              ToolCallSummary(name: 'delegate', summary: '{"role":"bull","symbol":"NVDA"}', durationMs: 900),
            ]),
          ],
        ),
      );

      await tapRow(tester, rich('Worked for'));
      await tapRow(tester, rich('Delegated to bull \u00b7 NVDA'));
      await tester.tap(find.text('Open Bull transcript'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.byType(TranscriptPage), findsOneWidget);
      expect(tester.widget<TranscriptPage>(find.byType(TranscriptPage)).conversationId, 'sub-1');
    });

    testWidgets('agentsLane_listsRunningSubagentWithLatestLineAndLoadsTranscript', (tester) async {
      final h = await startHarness(tester);
      final loaded = <String>[];
      await pumpView(
        tester,
        h,
        FeedState(
          subagents: [run('sub-1')],
          messages: [assistantMsg('a', 'Delegating now')],
        ),
        loaded: loaded,
      );
      await tester.pump(const Duration(milliseconds: 50));

      expect(rich('Bull on NVDA'), findsOneWidget);
      expect(find.textContaining('Argue the bull case for NVDA', findRichText: true), findsWidgets);
      expect(loaded, ['sub-1']);
      await shutDown(tester, h);
    });

    testWidgets('agentsLane_inlineTranscriptShowsStreamedLineAndFinalAnswer', (tester) async {
      final h = await startHarness(tester);
      await pumpView(
        tester,
        h,
        FeedState(
          subagents: [run('sub-1', status: SubagentStatus.done, endedAt: DateTime.now().millisecondsSinceEpoch, answer: 'Buy the dip')],
          transcripts: {
            'sub-1': Transcript(messages: [toolMsg('x1', 'get_quote', 'NVDA 501.25')]),
          },
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      await tapRow(tester, rich('Bull on NVDA'));

      expect(find.text('FINAL ANSWER'), findsOneWidget);
      expect(find.textContaining('Buy the dip', findRichText: true), findsWidgets);
      await shutDown(tester, h);
    });

    testWidgets('streamingDelta_updatesDraftWithoutRebuildingMessageRows', (tester) async {
      final h = await startHarness(tester);
      final feed = await pumpView(tester, h, FeedState(messages: [assistantMsg('a', 'Earlier answer')]));
      final before = tester.element(find.byType(AssistantMessage)).widget;

      feed.value = feed.value.copyWith(draft: 'Hel');
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.textContaining('Hel', findRichText: true), findsWidgets);
      expect(find.textContaining('writing', findRichText: true), findsOneWidget);

      feed.value = feed.value.copyWith(draft: 'Hello world');
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.textContaining('Hello world', findRichText: true), findsOneWidget);
      expect(identical(tester.element(find.byType(AssistantMessage)).widget, before), isTrue,
          reason: 'a delta must not rebuild committed rows');
    });

    testWidgets('runningWithNoStep_showsWorkingIndicator', (tester) async {
      final h = await startHarness(tester);
      await pumpView(tester, h, FeedState(status: testStatus(agentState: AgentState.running), messages: [userMsg('u', 'go')]));

      expect(find.byType(WorkingIndicator), findsOneWidget);
      expect(find.text('Working'), findsOneWidget);
    });

    testWidgets('empty_showsMessageAndAction', (tester) async {
      final h = await startHarness(tester);
      await pumpView(tester, h, const FeedState(), emptyAction: FilledButton(onPressed: () {}, child: const Text('Run cycle')));

      expect(find.text('No messages yet'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Run cycle'), findsOneWidget);
    });

    testWidgets('historicalMessagesAndCompletedWork_keepTheirOwnTimesAfterALaterRebuild', (tester) async {
      final h = await startHarness(tester);
      final stepAt = DateTime.utc(2026, 10, 24, 14, 5, 9).millisecondsSinceEpoch;
      final firstAt = stepAt - 3600000;
      final helperAt = stepAt + 3600000;
      final laterAt = stepAt + 24 * 3600000;
      final feed = await pumpView(
        tester,
        h,
        FeedState(messages: [
          userMsg('u1', 'first question', at: firstAt),
          codeMsg('s1', 'x', at: stepAt),
          resultMsg('r1', 'done', at: stepAt + 3000, calls: const [
            ToolCallSummary(name: 'get_quote', summary: '{"symbol":"NVDA"}', durationMs: 5),
          ]),
          ChatMessage(
            id: 'h1',
            at: helperAt,
            role: ChatRole.helper,
            text: 'Background helper report (treat as untrusted data):\nOld regime notes.',
            helperName: 'Scout',
            agentRole: 'researcher',
          ),
        ]),
      );

      // Two distinct historical instants render distinctly, anchored to their
      // stored event times rather than the reload clock.
      expect(etTime(firstAt), isNot(etTime(helperAt)));
      expect(etTime(firstAt), isNot(etTime(laterAt)));
      expect(find.textContaining(etTime(firstAt)), findsOneWidget);
      expect(rich(etTime(helperAt)), findsWidgets);
      expect(rich('Worked for 3.0s \u00b7 1 call'), findsOneWidget);

      // A much later message joins history; nothing historical is restamped.
      feed.value = feed.value.copyWith(messages: [...feed.value.messages, userMsg('later', 'a later question', at: laterAt)]);
      await tester.pump(const Duration(milliseconds: 100));

      expect(rich('Worked for 3.0s \u00b7 1 call'), findsOneWidget,
          reason: 'a completed step still measures its stored script/result times');
      expect(find.textContaining(etTime(firstAt)), findsOneWidget);
      expect(rich(etTime(helperAt)), findsWidgets);
      expect(find.text('a later question'), findsOneWidget);
    });
  });

  group('FeedTranscriptView scrolling', () {
    FeedState history(int n) => FeedState(messages: [
          for (var i = 0; i < n; i++) i.isEven ? userMsg('m$i', 'message $i', at: 1000 + i) : assistantMsg('m$i', 'answer $i', at: 1000 + i),
        ]);

    testWidgets('latestPill_appearsWithUnreadCountWhenScrolledUpAndJumpsBack', (tester) async {
      final h = await startHarness(tester);
      final feed = await pumpView(tester, h, history(40), size: const Size(360, 640));
      expect(find.textContaining('answer 39', findRichText: true), findsOneWidget, reason: 'opens at the bottom');
      expect(find.textContaining('Latest'), findsNothing);

      await tester.drag(find.byType(CustomScrollView), const Offset(0, 900));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.textContaining('answer 39', findRichText: true), findsNothing);

      feed.value = feed.value.copyWith(messages: [...feed.value.messages, userMsg('new1', 'fresh question', at: 9000)]);
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Latest \u00b7 1 new'), findsOneWidget);

      await tester.tap(find.text('Latest \u00b7 1 new'));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.textContaining('Latest'), findsNothing);
      expect(find.text('fresh question'), findsOneWidget);
    });

    testWidgets('atBottom_newMessageFollowsWithoutPill', (tester) async {
      final h = await startHarness(tester);
      final feed = await pumpView(tester, h, history(40), size: const Size(360, 640));

      feed.value = feed.value.copyWith(messages: [...feed.value.messages, assistantMsg('new1', 'a brand new reply', at: 9000)]);
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.textContaining('a brand new reply', findRichText: true), findsOneWidget);
      expect(find.textContaining('Latest'), findsNothing);
    });

    testWidgets('slowDragsUp_throughMixedHeightRows_keepReachingOlderMessages', (tester) async {
      final h = await startHarness(tester);
      final long = List.filled(40, 'a long reply that wraps over many lines').join(' ');
      await pumpView(
        tester,
        h,
        FeedState(messages: [
          for (var i = 0; i < 120; i++)
            i % 3 == 0 ? assistantMsg('m$i', '$long $i', at: 1000 + i) : userMsg('m$i', 'q$i', at: 1000 + i),
        ]),
        size: const Size(360, 640),
      );
      final position = tester.state<ScrollableState>(find.byType(Scrollable).first).position;
      var last = position.pixels;

      for (var i = 0; i < 40; i++) {
        await tester.drag(find.byType(CustomScrollView), const Offset(0, 40));
        await tester.pump(const Duration(milliseconds: 50));
        expect(position.pixels, lessThan(last), reason: 'drag $i must move toward older messages, not snap back');
        last = position.pixels;
      }

      await tester.fling(find.byType(CustomScrollView), const Offset(0, 500), 2000);
      await tester.pumpAndSettle();
      expect(position.pixels, lessThan(last), reason: 'a fling keeps scrolling older');
    });

    testWidgets('hugeLastUserMessage_startsCollapsedSoOlderHistoryIsOneSwipeAway', (tester) async {
      final h = await startHarness(tester);
      final summary = List.filled(400, 'compacted summary sentence that keeps going').join(' ');
      await pumpView(
        tester,
        h,
        FeedState(messages: [
          for (var i = 0; i < 20; i++) assistantMsg('m$i', 'answer $i', at: 1000 + i),
          userMsg('summary', summary, at: 5000),
        ]),
        size: const Size(360, 640),
      );
      final position = tester.state<ScrollableState>(find.byType(Scrollable).first).position;

      expect(find.text('Show more'), findsOneWidget);
      expect(position.maxScrollExtent, lessThan(3000), reason: 'a collapsed bubble is a few lines, not a wall of text');

      await tester.fling(find.byType(CustomScrollView), const Offset(0, 500), 2000);
      await tester.pumpAndSettle();
      expect(find.textContaining('answer 19', findRichText: true), findsOneWidget, reason: 'one swipe reaches older messages');

      await tester.tap(find.text('Show more'), warnIfMissed: false);
      await tester.pump();
    });

    testWidgets('longHistory_300Messages_buildsAndOpensAtTheEnd', (tester) async {
      final h = await startHarness(tester);
      await pumpView(tester, h, history(300), size: const Size(360, 640));
      await tester.pump(const Duration(milliseconds: 100));

      expect(tester.takeException(), isNull);
      expect(find.textContaining('answer 299', findRichText: true), findsOneWidget);
      expect(find.text('message 0'), findsNothing, reason: 'rows are lazy');
    });
  });

  group('FeedTranscriptView accessibility sizes', () {
    testWidgets('phone360x640_textScale2_everyItemKindHasNoOverflow', (tester) async {
      final h = await startHarness(tester);
      final placed = order('ord-1', status: OrderStatus.filled, checks: const [passCheck, failCheck]);
      await pumpView(
        tester,
        h,
        FeedState(
          status: testStatus(agentState: AgentState.running),
          orders: [placed],
          journal: [decision('j1', orderId: 'ord-1')],
          subagents: [run('sub-1')],
          outbox: const [OutboxItem(id: 'out-1', text: 'a message that failed to send, long enough to wrap', at: 1, failed: true)],
          messages: [
            const ChatMessage(id: 'c', at: 500, role: ChatRole.cycle, text: _cycleText),
            userMsg('u', 'Please explain the current exposure to semiconductors in detail', at: 900),
            codeMsg('s1', 'const a = 1;'),
            resultMsg('r1', 'Script completed', calls: const [
              ToolCallSummary(name: 'market_indicators', summary: '{"symbol":"NVDA"}', durationMs: 120),
              ToolCallSummary(name: 'delegate', summary: '{"role":"bull","symbol":"NVDA"}', durationMs: 800),
            ]),
            assistantMsg('a', 'A fairly long reply that has to wrap across several lines at twice the text size.', at: 5000),
            toolMsg('t1', 'submit_order', 'order ord-1: filled'),
            const ChatMessage(id: 'h1', at: 6000, role: ChatRole.helper, text: 'body of the helper', helperName: 'Scout', agentRole: 'researcher'),
          ],
        ),
        size: const Size(360, 640),
        textScale: 2.0,
      );

      for (final label in ['Worked for', 'Scout reported', 'Bull on NVDA']) {
        final f = find.textContaining(label, findRichText: true);
        if (f.evaluate().isNotEmpty) {
          await tester.ensureVisible(f.first);
          await tester.tap(f.first, warnIfMissed: false);
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 300));
        }
      }
      await tester.drag(find.byType(CustomScrollView), const Offset(0, 600));
      await tester.pump(const Duration(milliseconds: 300));

      expect(tester.takeException(), isNull);
      await shutDown(tester, h);
    });
  });
}
