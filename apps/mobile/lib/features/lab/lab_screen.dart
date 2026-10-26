import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/sim_calc.dart' hide upsertSimRun, upsertSuite;

import 'compare_page.dart';
import 'lab_cards.dart';
import 'lab_widgets.dart';
import 'new_sim_sheet.dart';
import 'new_suite_sheet.dart';

enum _LabTab { runs, suites }

/// Most runs the compare view takes at once (the web keeps the last five).
const int maxCompareRuns = 5;

/// The simulation lab: paper-money runs and suites, with compare. A full
/// screen pushed from the More menu.
class LabScreen extends ConsumerStatefulWidget {
  const LabScreen({super.key});

  @override
  ConsumerState<LabScreen> createState() => _LabScreenState();
}

class _LabScreenState extends ConsumerState<LabScreen> {
  _LabTab _tab = _LabTab.runs;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (!mounted) return;
      final store = ref.read(simProvider.notifier);
      if (!ref.read(simProvider).loaded) store.loadRuns();
    });
  }

  Future<void> _refresh() => ref.read(simProvider.notifier).loadRuns();

  void _toggle(String id) {
    final notifier = ref.read(simCompareProvider.notifier);
    final current = ref.read(simCompareProvider);
    if (!current.contains(id) && current.length >= maxCompareRuns) {
      notifier.toggle(current.first);
    }
    notifier.toggle(id);
  }

  void _compare(List<String> ids) {
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(builder: (_) => ComparePage(runIds: ids)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sim = ref.watch(simProvider);
    final offline = ref.watch(
      harnessProvider.select((s) => s.connection == ConnectionStatus.offline),
    );
    final selected = ref.watch(simCompareProvider);
    final c = context.lb;

    final existing = {for (final r in sim.runs) r.id};
    final picked = [
      for (final id in selected)
        if (existing.contains(id)) id,
    ];
    final activeRuns = sim.runs.where((r) => isActive(r.status)).length;
    final activeSuites = sim.suites.where((s) => isActive(s.status)).length;
    final runsTab = _tab == _LabTab.runs;
    final canCompare = runsTab && picked.length >= 2;

    final emptyTab =
        sim.loaded && (runsTab ? sim.runs.isEmpty : sim.suites.isEmpty);
    final FloatingActionButton? fab = emptyTab && !canCompare
        ? null
        : canCompare
        ? FloatingActionButton.extended(
            heroTag: null,
            onPressed: () => _compare(picked),
            backgroundColor: c.lab,
            foregroundColor: c.background,
            icon: const LbIcon(LbIcons.gitCompare, size: 20),
            label: Text('Compare ${picked.length} runs'),
          )
        : FloatingActionButton.extended(
            heroTag: null,
            onPressed: () =>
                runsTab ? showNewSimSheet(context) : showNewSuiteSheet(context),
            backgroundColor: c.lab,
            foregroundColor: c.background,
            icon: const LbIcon(LbIcons.add01, size: 20),
            label: Text(runsTab ? 'New simulation' : 'New suite'),
          );

    return LabTheme(
      child: LbPageScaffold(
        title: 'Lab',
        largeTitle: false,
        onRefresh: _refresh,
        floatingActionButton: fab,
        banner: offline ? StaleBanner(offline: true, onRetry: _refresh) : null,
        actions: [
          if (runsTab && picked.isNotEmpty)
            IconButton(
              tooltip: 'Clear selection',
              onPressed: ref.read(simCompareProvider.notifier).clear,
              icon: const LbIcon(LbIcons.close),
            ),
        ],
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: LbSpace.gap),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LbSegmented<_LabTab>(
                    semanticLabel: 'Lab sections',
                    selected: _tab,
                    onChanged: (v) => setState(() => _tab = v),
                    segments: const [
                      LbSegment(_LabTab.runs, 'Runs'),
                      LbSegment(_LabTab.suites, 'Suites'),
                    ],
                  ),
                  const SizedBox(height: LbSpace.gap),
                  Wrap(
                    spacing: 12,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      const PaperBadge(),
                      if (activeRuns + activeSuites > 0)
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            PulseDot(color: c.lab, size: 7),
                            const SizedBox(width: 6),
                            Text(
                              '$activeRuns running${activeSuites > 0 ? ' \u00b7 $activeSuites suite${activeSuites > 1 ? 's' : ''}' : ''}',
                              style: LbText.number(
                                context,
                                size: 12,
                                color: c.lab,
                                weight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          if (runsTab)
            ..._runSlivers(sim, picked.toSet())
          else
            ..._suiteSlivers(sim),
          const SliverToBoxAdapter(child: SizedBox(height: 88)),
        ],
      ),
    );
  }

  List<Widget> _skeleton(double height, int n) => [
    SliverList.separated(
      itemCount: n,
      separatorBuilder: (_, _) => const SizedBox(height: LbSpace.gap),
      itemBuilder: (_, _) => SkeletonBlock(height: height, radius: LbRadius.lg),
    ),
  ];

  Widget _staleNote(SimState sim) {
    if (sim.loadError == null) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          'Could not refresh: ${sim.loadError}',
          style: Theme.of(context).textTheme.bodySmall
              ?.copyWith(color: context.lb.warn),
        ),
      ),
    );
  }

  List<Widget> _runSlivers(SimState sim, Set<String> picked) {
    if (!sim.loaded) return _skeleton(168, 3);
    if (sim.loadError != null && sim.runs.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: ErrorState(
            title: 'Could not load simulations',
            message: sim.loadError!,
            onRetry: _refresh,
          ),
        ),
      ];
    }
    if (sim.runs.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: Empty(
            icon: LbIcons.flaskConical,
            title: 'No simulations yet',
            message: 'A simulation replays past trading days against a paper broker, so you can test a strategy idea without risking money.',
            action: LabButton(
              label: 'New simulation',
              onPressed: () => showNewSimSheet(context),
            ),
          ),
        ),
      ];
    }
    final cols = labColumns(context);
    return [
      _staleNote(sim),
      AdaptiveCardSliver(
        count: sim.runs.length,
        columns: cols,
        itemBuilder: (context, i) {
          final run = sim.runs[i];
          return RunCard(
            key: ValueKey(run.id),
            run: run,
            selected: picked.contains(run.id),
            onOpen: () => AppNav.run(context, run.id),
            onToggle: () => _toggle(run.id),
          );
        },
      ),
    ];
  }

  List<Widget> _suiteSlivers(SimState sim) {
    if (!sim.loaded) return _skeleton(120, 2);
    if (sim.loadError != null && sim.suites.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: ErrorState(
            title: 'Could not load suites',
            message: sim.loadError!,
            onRetry: _refresh,
          ),
        ),
      ];
    }
    if (sim.suites.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: Empty(
            icon: LbIcons.gitCompare,
            title: 'No suites yet',
            message: 'A suite runs two variants of a strategy on identical markets and shows which one holds up.',
            action: LabButton(
              label: 'New suite',
              onPressed: () => showNewSuiteSheet(context),
            ),
          ),
        ),
      ];
    }
    final cols = labColumns(context);
    return [
      _staleNote(sim),
      AdaptiveCardSliver(
        count: sim.suites.length,
        columns: cols,
        itemBuilder: (context, i) {
          final suite = sim.suites[i];
          return SuiteCard(
            key: ValueKey(suite.id),
            suite: suite,
            runs: sim.runs,
            onOpen: () => AppNav.suite(context, suite.id),
          );
        },
      ),
    ];
  }
}
