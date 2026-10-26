import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/data.dart' show AppSectionKey;
import 'package:longbow/features/search/jump_results.dart';
import 'package:longbow/models/models.dart';

List<JumpEntry> _build(
  String query, {
  List<String> held = const ['NVDA', 'SPY'],
  List<String> watchlist = const ['QQQ', 'AAPL', 'NVDA'],
  Set<String> known = const {'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA'},
  List<NoteFile> notes = const [NoteFile(path: 'theses/NVDA.md', size: 1, updatedAt: 1), NoteFile(path: 'plans/week.md', size: 1, updatedAt: 1)],
  List<SkillSummary> skills = const [
    SkillSummary(name: 'risk-review', description: 'Check sizing before an entry'),
    SkillSummary(name: 'earnings-prep', description: 'Read the filing'),
  ],
}) =>
    buildJumpEntries(query: query, held: held, watchlist: watchlist, known: known, notes: notes, skills: skills);

List<String> _titles(List<JumpEntry> e, JumpGroup g) => [for (final x in e) if (x.group == g) x.title];

void main() {
  test('jump_emptyQuery_listsEveryGroupInOrderWithHeldBeforeWatchlistBeforeRecent', () {
    final entries = _build('');

    expect(entries.map((e) => e.group).toSet().toList(), [JumpGroup.pages, JumpGroup.symbols, JumpGroup.notes, JumpGroup.skills]);
    expect(_titles(entries, JumpGroup.pages), ['Feed', 'Portfolio', 'Markets', 'Performance', 'Agent', 'Reports', 'Journal and orders', 'Lab', 'Settings']);
    // Held (NVDA, SPY) first, then watchlist-only (AAPL, QQQ), then recently seen (TSLA); no repeats.
    expect(_titles(entries, JumpGroup.symbols), ['NVDA', 'SPY', 'AAPL', 'QQQ', 'TSLA']);
    expect([for (final e in entries) if (e.group == JumpGroup.symbols) e.tag], ['held', 'held', 'watchlist', 'watchlist', 'recent']);
  });

  test('jump_query_matchesTickersByContainsWithPrefixFirst', () {
    final symbols = _titles(_build('a', known: const {'AAPL', 'NVDA', 'SPY', 'QQQ', 'TSLA'}), JumpGroup.symbols);

    expect(symbols.first, 'AAPL', reason: 'prefix match leads');
    expect(symbols.toSet(), {'AAPL', 'NVDA', 'TSLA'});
  });

  test('jump_query_filtersPagesByLabelAndKeywords', () {
    expect(_titles(_build('rep'), JumpGroup.pages), ['Reports']);
    expect(_titles(_build('vix'), JumpGroup.pages), ['Markets'], reason: 'keyword, not label');
    expect(_titles(_build('paper'), JumpGroup.pages), ['Lab']);
  });

  test('jump_pageTargets_pointAtTheRightDestination', () {
    final byTitle = {for (final e in _build('').where((e) => e.group == JumpGroup.pages)) e.title: e.target};

    expect((byTitle['Journal and orders'] as JumpSection).section, AppSectionKey.history);
    expect((byTitle['Reports'] as JumpSection).section, AppSectionKey.reports);
    expect((byTitle['Agent'] as JumpSection).section, AppSectionKey.agent);
    expect(byTitle['Settings'], isA<JumpSettings>());
  });

  test('jump_unknownTickerShapedQuery_offersToOpenItsChart', () {
    final entries = _build('zzz');

    final chart = entries.firstWhere((e) => e.group == JumpGroup.chart);
    expect(chart.title, 'ZZZ');
    expect((chart.target as JumpSymbol).symbol, 'ZZZ');
    expect(entries.first, chart, reason: 'chart row leads');
  });

  test('jump_knownOrNonTickerQuery_doesNotOfferAChart', () {
    expect(_build('nvda').where((e) => e.group == JumpGroup.chart), isEmpty, reason: 'NVDA is already a symbol row');
    expect(_build('not a ticker').where((e) => e.group == JumpGroup.chart), isEmpty);
    expect(_build('toolongtickername').where((e) => e.group == JumpGroup.chart), isEmpty);
  });

  test('jump_notesAndSkills_matchPathNameAndDescription', () {
    final entries = _build('nvda');
    expect(_titles(entries, JumpGroup.notes), ['theses/NVDA.md']);

    final bySizing = _build('sizing');
    expect(_titles(bySizing, JumpGroup.skills), ['risk-review'], reason: 'matched on the description');
    expect((bySizing.firstWhere((e) => e.group == JumpGroup.skills).target as JumpSkill).name, 'risk-review');
    expect(_titles(_build('plans'), JumpGroup.notes), ['plans/week.md']);
  });

  test('jump_noMatch_returnsNothing', () {
    expect(_build('qqqqzz!!'), isEmpty);
  });
}
