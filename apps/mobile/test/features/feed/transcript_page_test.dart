import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/feed/transcript_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'feed_test_utils.dart';

void main() {
  group('TranscriptPage', () {
    testWidgets('liveSubagent_showsHeaderMessagesAndFinalAnswer', (tester) async {
      final h = await startHarness(tester, script: (api) {
        api.on('subagents', () async => [run('sub-1', status: SubagentStatus.done, endedAt: 4500, answer: 'Buy the dip, stop at 480')]);
        api.on('conversationMessages', () async => [
              assistantMsg('m1', 'Checking the earnings revisions first.', at: 1600),
              toolMsg('m2', 'get_quote', 'NVDA 501.25', at: 1700),
              assistantMsg('m3', 'Buy the dip, stop at 480', at: 4400),
            ]);
      });
      await pumpScreen(tester, const TranscriptPage(conversationId: 'sub-1'), harness: h);
      await settle(tester, h);

      expect(find.text('Bull on NVDA'), findsOneWidget, reason: 'page title');
      expect(find.text('Done'), findsOneWidget);
      expect(find.text('Argue the bull case for NVDA'), findsOneWidget);
      expect(find.textContaining('Checking the earnings revisions first.', findRichText: true), findsOneWidget);
      expect(find.textContaining('Bull \u00b7', findRichText: true), findsWidgets, reason: 'messages are labelled with the role');
      expect(find.text('FINAL ANSWER'), findsOneWidget);
      expect(find.textContaining('Buy the dip, stop at 480', findRichText: true), findsOneWidget, reason: 'the answer is not shown twice');
      expect(find.byType(TextField), findsNothing, reason: 'no composer on a subagent page');
      expect(find.byTooltip('Back'), findsOneWidget);
    });

    testWidgets('simulationRun_loadsTheConversationThroughTheSimStore', (tester) async {
      final h = await startHarness(tester, script: (api) {
        api.on('simMessages', () async => [assistantMsg('m1', 'Simulated bear thesis', at: 1600)]);
      });
      await pumpScreen(tester, const TranscriptPage(conversationId: 'sub-9', simRunId: 'run-1'), harness: h);
      await settle(tester, h);

      expect(h.api.count('simMessages'), 1);
      expect(h.api.count('conversationMessages'), 0, reason: 'a lab transcript never reads the live account');
      expect(find.textContaining('Simulated bear thesis', findRichText: true), findsOneWidget);
    });

    testWidgets('loadFailure_showsUnavailableWithRetry', (tester) async {
      final h = await startHarness(tester, script: (api) {
        api.fail('conversationMessages', const ApiError(404, 'gone'));
      });
      await pumpScreen(tester, const TranscriptPage(conversationId: 'sub-1'), harness: h);
      await settle(tester, h);

      expect(find.text('Transcript unavailable'), findsOneWidget);

      h.api.on('conversationMessages', () async => [assistantMsg('m1', 'Recovered text', at: 1600)]);
      await tester.tap(find.widgetWithText(OutlinedButton, 'Retry'));
      await tester.pump();
      await settle(tester, h);

      expect(find.textContaining('Recovered text', findRichText: true), findsOneWidget);
      expect(find.byType(ErrorState), findsNothing);
    });

    testWidgets('phone360x640_textScale2_longTaskAndMessagesDoNotOverflow', (tester) async {
      final h = await startHarness(tester, script: (api) {
        api.on('subagents', () async => [run('sub-1', status: SubagentStatus.failed, endedAt: 4500)]);
        api.on('conversationMessages', () async => [
              for (var i = 0; i < 12; i++) assistantMsg('m$i', 'A paragraph of analysis number $i that is long enough to wrap.', at: 1600 + i),
            ]);
      });
      await pumpScreen(tester, const TranscriptPage(conversationId: 'sub-1'), harness: h, size: const Size(360, 640), textScale: 2.0);
      await settle(tester, h);

      expect(tester.takeException(), isNull);
      expect(find.text('Failed'), findsOneWidget);
    });
  });
}
