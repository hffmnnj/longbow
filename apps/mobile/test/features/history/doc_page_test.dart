import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/history/doc_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

const _note = NoteFile(path: 'theses/NVDA.md', size: 10164, updatedAt: 1792973092635);

Future<void> _settle(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 300));
  for (var i = 0; i < 5; i++) {
    await tester.pump();
  }
}

void main() {
  group('DocPage', () {
    testWidgets('note shows markdown, updated time and copy', (tester) async {
      var copied = '';
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
            if (call.method == 'Clipboard.setData') {
              copied = (call.arguments as Map)['text'] as String;
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, null),
      );

      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on('notes', () async => [_note]);
      harness.api.on(
        'note',
        () async => const NoteContent(
          path: 'theses/NVDA.md',
          content: '# NVDA\nStrong quarter.',
          updatedAt: 1792973092635,
        ),
      );
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadDoc('note', _note.path));
      await pumpScreen(
        tester,
        const DocPage(kind: DocKind.note, id: 'theses/NVDA.md'),
        harness: harness,
      );
      await _settle(tester);

      expect(find.text('NVDA'), findsWidgets);
      expect(find.textContaining('Updated'), findsOneWidget);
      expect(find.textContaining('9.9 KB'), findsOneWidget);
      expect(find.text('Strong quarter.'), findsOneWidget);

      await tester.tap(find.byTooltip('Copy'));
      await _settle(tester);
      expect(copied, contains('Strong quarter.'));
      expect(find.text('Copied'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('skill shows description and body', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      const summary = SkillSummary(
        name: 'market-regime',
        description: 'Classifies the market trend.',
      );
      harness.api.on('skills', () async => [summary]);
      harness.api.on(
        'skill',
        () async => const Skill(
          name: 'market-regime',
          description: 'Classifies the market trend.',
          body: '## Regime\nRead SPY first.',
          files: [],
        ),
      );
      await tester.runAsync(harness.start);
      await tester.runAsync(
        () => harness.notifier.loadDoc('skill', 'market-regime'),
      );
      await pumpScreen(
        tester,
        const DocPage(kind: DocKind.skill, id: 'market-regime'),
        harness: harness,
      );
      await _settle(tester);

      expect(find.text('Classifies the market trend.'), findsOneWidget);
      expect(find.text('Read SPY first.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('shows an error with Retry, and retries', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.fail('note', Exception('boom'));
      await tester.runAsync(harness.start);
      await pumpScreen(
        tester,
        const DocPage(kind: DocKind.note, id: 'theses/NVDA.md'),
        harness: harness,
      );
      await _settle(tester);

      expect(find.textContaining('Could not load this'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await _settle(tester);
      expect(harness.api.count('note'), 2);
      expect(tester.takeException(), isNull);
    });

    testWidgets('live-refreshes when the store updates the doc',
        (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on(
        'note',
        () async => const NoteContent(
          path: 'plan.md',
          content: 'Version one.',
          updatedAt: 1,
        ),
      );
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadDoc('note', 'plan.md'));
      await pumpScreen(
        tester,
        const DocPage(kind: DocKind.note, id: 'plan.md'),
        harness: harness,
      );
      await _settle(tester);
      expect(find.text('Version one.'), findsOneWidget);

      harness.api.on(
        'note',
        () async => const NoteContent(
          path: 'plan.md',
          content: 'Version two.',
          updatedAt: 2,
        ),
      );
      await tester.runAsync(
        () => harness.notifier.loadDoc('note', 'plan.md', true),
      );
      await _settle(tester);

      expect(find.text('Version two.'), findsOneWidget);
      expect(find.text('Version one.'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('passes at 360x640 with text scale 2.0', (tester) async {
      final harness = await StoreHarness.create();
      addTearDown(harness.dispose);
      harness.api.on(
        'note',
        () async => const NoteContent(
          path: 'plan.md',
          content: '# Plan\nStay patient and keep positions small.',
          updatedAt: 1,
        ),
      );
      await tester.runAsync(harness.start);
      await tester.runAsync(() => harness.notifier.loadDoc('note', 'plan.md'));
      await pumpScreen(
        tester,
        const DocPage(kind: DocKind.note, id: 'plan.md'),
        harness: harness,
        size: const Size(360, 640),
        textScale: 2.0,
      );
      await _settle(tester);

      expect(find.text('Stay patient and keep positions small.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
