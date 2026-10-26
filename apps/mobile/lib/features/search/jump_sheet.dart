import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;

import 'jump_results.dart';

export 'jump_results.dart' show JumpTarget;

/// Opens the jump-to sheet: one field over pages, symbols, notes and skills.
/// Symbols, notes and skills open through [AppNav]; pages call [onSection]
/// (the shell selects a tab or pushes the page). The target opens after the
/// sheet has closed.
Future<void> showJumpSheet(BuildContext context, {required ValueChanged<AppSectionKey> onSection}) async {
  final target = await showLbSheet<JumpTarget>(
    context,
    (_) => const JumpSheet(),
    title: 'Jump to',
    fullHeight: true,
  );
  if (target == null || !context.mounted) return;
  switch (target) {
    case JumpSection(:final section):
      onSection(section);
    case JumpSymbol(:final symbol):
      await AppNav.symbol(context, symbol);
    case JumpNote(:final path):
      await AppNav.note(context, path);
    case JumpSkill(:final name):
      await AppNav.skill(context, name);
    case JumpSettings():
      await AppNav.settings(context);
  }
}

/// The sheet body: search field plus grouped results. Pops with the chosen
/// [JumpTarget].
class JumpSheet extends ConsumerStatefulWidget {
  const JumpSheet({super.key});

  @override
  ConsumerState<JumpSheet> createState() => _JumpSheetState();
}

class _JumpSheetState extends ConsumerState<JumpSheet> {
  final _controller = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  List<JumpEntry> _entries() {
    final feed = ref.watch(harnessProvider.select((s) => s.feed));
    final skills = ref.watch(harnessProvider.select((s) => s.skills));
    final known = ref.watch(knownSymbolsProvider);
    return buildJumpEntries(
      query: _query,
      held: feed.status?.account?.positions.map((p) => p.symbol).toList() ?? const [],
      watchlist: feed.status?.settings.watchlist ?? const [],
      known: known,
      notes: feed.notes,
      skills: skills,
    );
  }

  void _pick(JumpEntry e) => Navigator.of(context).pop(e.target);

  @override
  Widget build(BuildContext context) {
    final entries = _entries();
    final c = context.lb;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(LbSpace.screen, 4, LbSpace.screen, LbSpace.gap),
          child: LbSearchField(
            controller: _controller,
            hint: 'Ticker, page, note or skill',
            autofocus: true,
            onChanged: (v) => setState(() => _query = v),
            onSubmitted: (_) {
              if (entries.isNotEmpty) _pick(entries.first);
            },
          ),
        ),
        Expanded(
          child: entries.isEmpty
              ? Empty(
                  title: 'No match',
                  message: 'Try a ticker, a page like Reports, or part of a note or skill name.',
                  icon: LbIcons.searching,
                )
              : ListView.builder(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.only(bottom: LbSpace.screen),
                  itemCount: entries.length,
                  itemBuilder: (context, i) {
                    final e = entries[i];
                    final firstOfGroup = i == 0 || entries[i - 1].group != e.group;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (firstOfGroup)
                          SectionLabel(e.group.title, padding: const EdgeInsets.fromLTRB(LbSpace.screen, LbSpace.screen, LbSpace.screen, 4)),
                        ListTile(
                          minTileHeight: 52,
                          contentPadding: const EdgeInsets.symmetric(horizontal: LbSpace.screen),
                          leading: LbIcon(e.icon, color: c.mutedForeground),
                          title: Text(
                            e.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: e.mono ? LbText.number(context, size: 14.5, weight: e.group == JumpGroup.symbols || e.group == JumpGroup.chart ? FontWeight.w600 : FontWeight.w400) : null,
                          ),
                          subtitle: e.subtitle == null ? null : Text(e.subtitle!, maxLines: 2, overflow: TextOverflow.ellipsis),
                          trailing: e.tag == null ? null : Text(e.tag!, style: LbText.muted(context, size: 12)),
                          onTap: () => _pick(e),
                        ),
                      ],
                    );
                  },
                ),
        ),
      ],
    );
  }
}
