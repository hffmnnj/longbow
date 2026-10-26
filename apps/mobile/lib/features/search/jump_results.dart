import 'package:flutter/widgets.dart';
import 'package:longbow/core/icons.dart';
import 'package:longbow/data/data.dart' show AppSectionKey;
import 'package:longbow/domain/settings_form.dart' show tickerPattern;
import 'package:longbow/models/models.dart';

/// What a jump-to row opens.
sealed class JumpTarget {
  const JumpTarget();
}

final class JumpSection extends JumpTarget {
  const JumpSection(this.section);
  final AppSectionKey section;
}

final class JumpSymbol extends JumpTarget {
  const JumpSymbol(this.symbol);
  final String symbol;
}

final class JumpNote extends JumpTarget {
  const JumpNote(this.path);
  final String path;
}

final class JumpSkill extends JumpTarget {
  const JumpSkill(this.name);
  final String name;
}

final class JumpSettings extends JumpTarget {
  const JumpSettings();
}

enum JumpGroup {
  chart('Chart'),
  pages('Go to'),
  symbols('Symbols'),
  notes('Notes'),
  skills('Skills');

  const JumpGroup(this.title);
  final String title;
}

class JumpEntry {
  const JumpEntry({
    required this.group,
    required this.title,
    required this.icon,
    required this.target,
    this.tag,
    this.subtitle,
    this.mono = false,
  });

  final JumpGroup group;
  final String title;
  final IconData icon;
  final JumpTarget target;

  /// Short qualifier on the right ("held", "watchlist").
  final String? tag;
  final String? subtitle;

  /// True for tickers, paths and names, shown in the mono face.
  final bool mono;
}

class _Page {
  const _Page(this.label, this.icon, this.target, this.keywords);
  final String label;
  final IconData icon;
  final JumpTarget target;
  final String keywords;
}

const List<_Page> _pages = [
  _Page('Feed', LbIcons.message01, JumpSection(AppSectionKey.feed), 'live transcript approvals chat'),
  _Page('Portfolio', LbIcons.briefcase01, JumpSection(AppSectionKey.portfolio), 'positions orders account equity'),
  _Page('Markets', LbIcons.globe02, JumpSection(AppSectionKey.markets), 'regime indices sectors vix yields breadth calendar earnings'),
  _Page('Performance', LbIcons.chartIncrease, JumpSection(AppSectionKey.performance), 'equity trades calibration exposure'),
  _Page('Agent', LbIcons.aiBrain01, JumpSection(AppSectionKey.agent), 'control room models cycle subagents notes skills'),
  _Page('Reports', LbIcons.news01, JumpSection(AppSectionKey.reports), 'daily weekly trade report'),
  _Page('Journal and orders', LbIcons.notebook01, JumpSection(AppSectionKey.history), 'history journal decisions orders'),
  _Page('Lab', LbIcons.flaskConical, JumpSection(AppSectionKey.lab), 'simulation runs suites paper'),
  _Page('Settings', LbIcons.settings02, JumpSettings(), 'risk limits watchlist cadence notifications theme server robinhood'),
];

/// Builds the grouped, filtered rows for the jump-to sheet. Pure: everything
/// it needs is passed in, so it is easy to test.
///
/// Groups come in the order chart (a typed ticker we do not know yet), pages,
/// symbols (held, then watchlist, then recently seen), notes, skills. An empty
/// [query] lists everything.
List<JumpEntry> buildJumpEntries({
  required String query,
  required List<String> held,
  required List<String> watchlist,
  required Set<String> known,
  required List<NoteFile> notes,
  required List<SkillSummary> skills,
}) {
  final q = query.trim().toLowerCase();
  bool hit(String text) => q.isEmpty || text.toLowerCase().contains(q);
  final out = <JumpEntry>[];

  final typed = query.trim().toUpperCase();
  final seen = <String>{...held, ...watchlist, ...known};
  if (typed.isNotEmpty && tickerPattern.hasMatch(typed) && !seen.contains(typed)) {
    out.add(JumpEntry(
      group: JumpGroup.chart,
      title: typed,
      subtitle: 'Open chart',
      icon: LbIcons.chartLineData01,
      target: JumpSymbol(typed),
      mono: true,
    ));
  }

  for (final p in _pages) {
    if (hit('${p.label} ${p.keywords}')) {
      out.add(JumpEntry(group: JumpGroup.pages, title: p.label, icon: p.icon, target: p.target));
    }
  }

  final symbols = <(String, String)>[];
  final listed = <String>{};
  void addSymbols(Iterable<String> source, String tag) {
    final sorted = source.toList()..sort();
    for (final s in sorted) {
      if (listed.add(s) && hit(s)) symbols.add((s, tag));
    }
  }

  addSymbols(held, 'held');
  addSymbols(watchlist, 'watchlist');
  addSymbols(known, 'recent');
  if (q.isNotEmpty) {
    // Prefix matches first, then the rest, each keeping the group order.
    final up = q.toUpperCase();
    symbols.sort((a, b) => (a.$1.startsWith(up) ? 0 : 1).compareTo(b.$1.startsWith(up) ? 0 : 1));
  }
  for (final (s, tag) in symbols) {
    out.add(JumpEntry(group: JumpGroup.symbols, title: s, tag: tag, icon: LbIcons.chartLineData01, target: JumpSymbol(s), mono: true));
  }

  for (final n in notes) {
    if (hit(n.path)) out.add(JumpEntry(group: JumpGroup.notes, title: n.path, icon: LbIcons.file01, target: JumpNote(n.path), mono: true));
  }
  for (final s in skills) {
    if (hit('${s.name} ${s.description}')) {
      out.add(JumpEntry(group: JumpGroup.skills, title: s.name, subtitle: s.description, icon: LbIcons.notebook01, target: JumpSkill(s.name), mono: true));
    }
  }
  return out;
}
