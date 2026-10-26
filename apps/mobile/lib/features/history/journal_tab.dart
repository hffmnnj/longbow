import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/models/models.dart';

import '../feed/decision_card.dart';

enum _ActionFilter { all, buy, sell, hold, watch }

JournalAction? _actionOf(_ActionFilter f) => switch (f) {
  _ActionFilter.all => null,
  _ActionFilter.buy => JournalAction.buy,
  _ActionFilter.sell => JournalAction.sell,
  _ActionFilter.hold => JournalAction.hold,
  _ActionFilter.watch => JournalAction.watch,
};

String _labelOf(_ActionFilter f) => switch (f) {
  _ActionFilter.all => 'All',
  _ActionFilter.buy => 'Buy',
  _ActionFilter.sell => 'Sell',
  _ActionFilter.hold => 'Hold',
  _ActionFilter.watch => 'Watch',
};

/// Journal entries newest first, with action filter chips and a symbol
/// search. Port of the web `Journal` (filters added for the native list).
class JournalTab extends ConsumerStatefulWidget {
  const JournalTab({super.key});

  @override
  ConsumerState<JournalTab> createState() => _JournalTabState();
}

class _JournalTabState extends ConsumerState<JournalTab> {
  _ActionFilter _action = _ActionFilter.all;
  final TextEditingController _search = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _clear() {
    setState(() {
      _action = _ActionFilter.all;
      _query = '';
      _search.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final loaded = ref.watch(harnessProvider.select((s) => s.loaded));
    final journal = ref.watch(harnessProvider.select((s) => s.feed.journal));
    final loadError = ref.watch(harnessProvider.select((s) => s.loadError));

    if (!loaded) {
      return const SliverToBoxAdapter(child: _JournalSkeleton());
    }

    var entries = journal.toList()
      ..sort((a, b) => b.at.compareTo(a.at));
    final action = _actionOf(_action);
    if (action != null) {
      entries = entries.where((e) => e.action == action).toList();
    }
    final q = _query.trim().toLowerCase();
    if (q.isNotEmpty) {
      entries =
          entries
              .where((e) => (e.symbol ?? '').toLowerCase().contains(q))
              .toList();
    }
    final filtering = _action != _ActionFilter.all || q.isNotEmpty;

    return SliverMainAxisGroup(
      slivers: [
        SliverToBoxAdapter(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LbSegmented<_ActionFilter>(
                semanticLabel: 'Journal action',
                selected: _action,
                onChanged: (f) => setState(() => _action = f),
                segments: [
                  for (final f in _ActionFilter.values)
                    LbSegment(f, _labelOf(f)),
                ],
              ),
              const SizedBox(height: 8),
              LbSearchField(
                controller: _search,
                hint: 'Search symbols',
                onChanged: (v) => setState(() => _query = v),
              ),
              if (loadError != null) ...[
                const SizedBox(height: 6),
                Text(
                  'Could not refresh: $loadError',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: context.lb.warn,
                  ),
                ),
              ],
              const SizedBox(height: 4),
            ],
          ),
        ),
        if (entries.isEmpty)
          SliverToBoxAdapter(
            child: Empty(
              title: filtering ? 'No entries match' : 'No decisions yet',
              message:
                  filtering
                      ? 'Try a different action or symbol.'
                      : 'The agent records every decision here.',
              action:
                  filtering
                      ? TextButton(onPressed: _clear, child: const Text('Clear filters'))
                      : null,
            ),
          )
        else
          SliverList.builder(
            itemCount: entries.length,
            itemBuilder: (context, i) => Padding(
              padding: const EdgeInsets.only(bottom: LbSpace.gap),
              child: DecisionCard(entry: entries[i]),
            ),
          ),
      ],
    );
  }
}

class _JournalSkeleton extends StatelessWidget {
  const _JournalSkeleton();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SkeletonBlock(width: 240, height: 36),
        SizedBox(height: 8),
        SkeletonBlock(height: 48),
        SizedBox(height: LbSpace.gap),
        SkeletonBlock(height: 96),
        SizedBox(height: LbSpace.gap),
        SkeletonBlock(height: 96),
      ],
    );
  }
}
