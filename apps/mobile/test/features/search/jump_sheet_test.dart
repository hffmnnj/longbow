import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/data.dart' show AppSectionKey;
import 'package:longbow/features/history/doc_page.dart';
import 'package:longbow/features/search/jump_sheet.dart';
import 'package:longbow/features/symbol/symbol_page.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

Future<(StoreHarness, List<AppSectionKey>)> _open(WidgetTester tester, {Size size = const Size(360, 800), double textScale = 1}) async {
  final h = await StoreHarness.create();
  h.api.on('notes', () async => [const NoteFile(path: 'theses/NVDA.md', size: 10, updatedAt: 1)]);
  h.api.on('skills', () async => [const SkillSummary(name: 'risk-review', description: 'Check sizing before an entry')]);
  await tester.runAsync(h.start);
  final sections = <AppSectionKey>[];
  await pumpScreen(
    tester,
    Builder(builder: (context) => Scaffold(body: Center(child: TextButton(onPressed: () => showJumpSheet(context, onSection: sections.add), child: const Text('Search'))))),
    harness: h,
    size: size,
    textScale: textScale,
  );
  await tester.tap(find.text('Search'));
  await _settle(tester);
  return (h, sections);
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 60));
  }
}

Finder get _field => find.byType(TextField);

void main() {
  testWidgets('jumpSheet_open_listsPagesSymbolsNotesAndSkillsFromTheStore', (tester) async {
    await _open(tester);

    expect(find.text('GO TO'), findsOneWidget);
    expect(find.text('Reports'), findsOneWidget);
    expect(find.text('Journal and orders'), findsOneWidget);
    // Account positions and watchlist come from the fake status.
    await tester.dragUntilVisible(find.text('SPY').first, find.byType(ListView), const Offset(0, -200));
    expect(find.text('held'), findsOneWidget);
    await tester.dragUntilVisible(find.text('theses/NVDA.md'), find.byType(ListView), const Offset(0, -300));
    await tester.dragUntilVisible(find.text('risk-review'), find.byType(ListView), const Offset(0, -300));
    expect(find.text('Check sizing before an entry'), findsOneWidget);
  });

  testWidgets('jumpSheet_typing_filtersRowsLiveAndClearingRestoresThem', (tester) async {
    await _open(tester);

    await tester.enterText(_field, 'spy');
    await tester.pump();
    expect(find.text('SPY'), findsOneWidget);
    expect(find.text('Reports'), findsNothing);
    expect(find.text('SYMBOLS'), findsOneWidget);
    expect(find.text('GO TO'), findsNothing, reason: 'empty groups lose their header');

    await tester.enterText(_field, '');
    await tester.pump();
    expect(find.text('Reports'), findsOneWidget);
  });

  testWidgets('jumpSheet_noMatch_showsEmptyState', (tester) async {
    await _open(tester);

    await tester.enterText(_field, 'qqqqzz!!');
    await tester.pump();

    expect(find.text('No match'), findsOneWidget);
    expect(find.byType(ListTile), findsNothing);
  });

  testWidgets('jumpSheet_pickPage_closesAndReportsTheSection', (tester) async {
    final (_, sections) = await _open(tester);

    await tester.tap(find.widgetWithText(ListTile, 'Markets'));
    await _settle(tester);

    expect(sections, [AppSectionKey.markets]);
    expect(find.text('Jump to'), findsNothing, reason: 'the sheet closed');
  });

  testWidgets('jumpSheet_pickSymbol_opensTheSymbolPage', (tester) async {
    await _open(tester);

    await tester.enterText(_field, 'spy');
    await tester.pump();
    await tester.tap(find.widgetWithText(ListTile, 'SPY'));
    await _settle(tester);
    await tester.pump(const Duration(seconds: 1));

    expect(tester.widget<SymbolPage>(find.byType(SymbolPage)).symbol, 'SPY');
  });

  testWidgets('jumpSheet_typedUnknownTicker_opensItsChart', (tester) async {
    await _open(tester);

    await tester.enterText(_field, 'zzz');
    await tester.pump();
    expect(find.text('CHART'), findsOneWidget);
    await tester.tap(find.widgetWithText(ListTile, 'ZZZ'));
    await _settle(tester);
    await tester.pump(const Duration(seconds: 1));

    expect(tester.widget<SymbolPage>(find.byType(SymbolPage)).symbol, 'ZZZ');
  });

  testWidgets('jumpSheet_pickNote_opensThatNote', (tester) async {
    await _open(tester);

    await tester.enterText(_field, 'theses');
    await tester.pump();
    await tester.tap(find.widgetWithText(ListTile, 'theses/NVDA.md'));
    await _settle(tester);
    await tester.pump(const Duration(seconds: 1));

    final page = tester.widget<DocPage>(find.byType(DocPage));
    expect(page.kind, DocKind.note);
    expect(page.id, 'theses/NVDA.md');
  });

  testWidgets('jumpSheet_submit_opensTheFirstResult', (tester) async {
    final (_, sections) = await _open(tester);

    await tester.enterText(_field, 'performance');
    await tester.pump();
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await _settle(tester);

    expect(sections, [AppSectionKey.performance]);
  });

  testWidgets('jumpSheet_textScale2At360x640_hasNoOverflow', (tester) async {
    await _open(tester, size: const Size(360, 640), textScale: 2.0);

    expect(tester.takeException(), isNull);
    await tester.enterText(_field, 'a');
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
