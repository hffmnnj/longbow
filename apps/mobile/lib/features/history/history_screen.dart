import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';

import 'journal_tab.dart';
import 'notes_tab.dart';
import 'orders_tab.dart';
import 'skills_tab.dart';

const _tabs = ['Journal', 'Orders', 'Notes', 'Skills'];

/// Journal, orders, notes and skills behind one TabBar. Port of the web
/// `HistoryTabs`: on phones the web uses a toggle group, which maps to tabs
/// here. No swipe between tabs (each tab keeps its own scroll and filter
/// state while mounted); the shared feed refreshes all of them at once.
class HistoryScreen extends ConsumerStatefulWidget {
  const HistoryScreen({super.key});

  @override
  ConsumerState<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends ConsumerState<HistoryScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _controller = TabController(
    length: _tabs.length,
    vsync: this,
  );
  int _index = 0;

  @override
  void initState() {
    super.initState();
    _controller.addListener(() {
      if (_controller.indexIsChanging && _controller.index != _index) {
        Haptics.selection();
        setState(() => _index = _controller.index);
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _refresh() => ref.read(harnessProvider.notifier).refresh();

  @override
  Widget build(BuildContext context) {
    final offline =
        ref.watch(harnessProvider.select((s) => s.connection)) ==
        ConnectionStatus.offline;
    return LbPageScaffold(
      title: 'History',
      onRefresh: _refresh,
      banner: offline ? StaleBanner(offline: true, onRetry: _refresh) : null,
      bottom: TabBar(
        controller: _controller,
        tabs: [for (final t in _tabs) Tab(text: t)],
      ),
      slivers: [
        SliverVisibility(
          visible: _index == 0,
          maintainState: true,
          sliver: const JournalTab(),
        ),
        SliverVisibility(
          visible: _index == 1,
          maintainState: true,
          sliver: const OrdersTab(),
        ),
        SliverVisibility(
          visible: _index == 2,
          maintainState: true,
          sliver: const NotesTab(),
        ),
        SliverVisibility(
          visible: _index == 3,
          maintainState: true,
          sliver: const SkillsTab(),
        ),
      ],
    );
  }
}
