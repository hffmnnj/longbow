import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/sim_calc.dart' hide upsertSimRun, upsertSuite;
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'lab_widgets.dart';

/// One suite: the verdict between variants, a summary per variant, the spread
/// of excess return per run, and every member run.
class SuitePage extends ConsumerStatefulWidget {
  const SuitePage({super.key, required this.suiteId});

  final String suiteId;

  @override
  ConsumerState<SuitePage> createState() => _SuitePageState();
}

class _SuitePageState extends ConsumerState<SuitePage> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (!mounted) return;
      final store = ref.read(simProvider.notifier);
      if (!ref.read(simProvider).loaded) store.loadRuns();
      store.loadScenarios();
    });
  }

  Future<void> _refresh() => ref.read(simProvider.notifier).loadRuns();

  Future<void> _stop(SimSuite suite) async {
    final ok = await showLbConfirm(
      context,
      title: 'Stop this suite?',
      message:
          'Runs in progress stop at their current day. Finished runs are kept.',
      confirmLabel: 'Stop suite',
      destructive: true,
    );
    if (!ok || !mounted) return;
    Haptics.warning();
    await ref.read(simProvider.notifier).stopSuite(suite.id);
  }

  @override
  Widget build(BuildContext context) {
    final id = widget.suiteId;
    final sim = ref.watch(simProvider);
    final offline = ref.watch(
      harnessProvider.select((s) => s.connection == ConnectionStatus.offline),
    );
    final suite = sim.suites.where((s) => s.id == id).firstOrNull;

    final Widget body;
    if (suite == null) {
      body = sim.loaded
          ? const Empty(
              icon: LbIcons.gitCompare,
              title: 'Suite not found',
              message: 'It may have been removed. Go back to the lab list.',
            )
          : const Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SkeletonBlock(height: 28),
                SizedBox(height: LbSpace.gap),
                SkeletonBlock(height: 90, radius: LbRadius.lg),
                SizedBox(height: LbSpace.gap),
                SkeletonBlock(height: 280, radius: LbRadius.lg),
              ],
            );
    } else {
      body = _SuiteBody(suite: suite, sim: sim, onStop: () => _stop(suite));
    }
    return LabTheme(
      child: LbPageScaffold(
        title: 'Suite',
        largeTitle: false,
        onRefresh: _refresh,
        banner: offline ? StaleBanner(offline: true, onRetry: _refresh) : null,
        slivers: [SliverToBoxAdapter(child: body)],
      ),
    );
  }
}

class _SuiteBody extends StatelessWidget {
  const _SuiteBody({
    required this.suite,
    required this.sim,
    required this.onStop,
  });

  final SimSuite suite;
  final SimState sim;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final t = Theme.of(context).textTheme;
    final live = isActive(suite.status);
    final progress = suiteProgress(suite, sim.runs);
    final reading = comparisonReading(suite);
    final labels = suite.config.variants.map((v) => v.label).toList();
    final meta = LbText.number(
      context,
      size: 12,
      color: c.mutedForeground,
      weight: FontWeight.w400,
    );

    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          header: true,
          child: Text(suite.config.name, style: t.titleMedium),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            const PaperBadge(),
            if (suite.startedBy == StartedBy.agent)
              const LabTag('By agent', neutral: true),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 14,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            RunStatusLabel(suite.status),
            Text(
              '${progress.done} of ${progress.total} runs done',
              style: meta,
            ),
            if (labels.isNotEmpty) Text(labels.join(' vs '), style: meta),
          ],
        ),
        if (live && progress.total > 0) ...[
          const SizedBox(height: 10),
          LabProgress(
            value: progress.done / progress.total,
            label: 'Suite progress',
          ),
        ],
        if (live) ...[
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: onStop,
              style: OutlinedButton.styleFrom(
                foregroundColor: c.destructive,
                side: BorderSide(color: c.destructive.withValues(alpha: 0.5)),
              ),
              icon: const LbIcon(LbIcons.stop, size: 16),
              label: const Text('Stop'),
            ),
          ),
        ],
      ],
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        header,
        const SizedBox(height: LbSpace.gap),
        if (reading != null) ...[
          _Verdict(
            title: labels.length == 2
                ? '${labels[0]} vs ${labels[1]}'
                : 'Comparison',
            reading: reading,
            pairs: suite.comparison!.pairs,
          ),
          const SizedBox(height: LbSpace.gap),
        ],
        TwoUp(
          left: [
            _SummaryPanel(suite: suite),
            _ExcessPanel(suite: suite, sim: sim),
          ],
          right: [
            for (final label in labels)
              _MarketsPanel(suite: suite, sim: sim, variant: label),
            if (labels.isEmpty)
              const Empty(title: 'No variants', icon: LbIcons.gitCompare),
          ],
        ),
      ],
    );
  }
}

class _Verdict extends StatelessWidget {
  const _Verdict({
    required this.title,
    required this.reading,
    required this.pairs,
  });

  final String title;
  final ComparisonReading reading;
  final int pairs;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Semantics(
      container: true,
      label: 'Variant comparison',
      child: LbCard(
        color: reading.conclusive ? c.labBg : null,
        borderColor: reading.conclusive ? c.lab.withValues(alpha: 0.5) : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SectionLabel(title),
            const SizedBox(height: 4),
            Text(reading.text, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(
              'Excess return over the benchmark, paired across $pairs markets.',
              style: LbText.muted(context, size: 12),
            ),
          ],
        ),
      ),
    );
  }
}

String _fmt(double? v, [String suffix = '']) {
  if (v == null) return simDash;
  final digits = v % 1 == 0 || v.abs() >= 10 ? 0 : 1;
  return '${v > 0 ? '+' : (v < 0 ? kMinus : '')}${v.abs().toStringAsFixed(digits)}$suffix';
}

class _SummaryRow {
  const _SummaryRow(this.label, this.text, {this.pnl});
  final String label;
  final String Function(SimSuiteVariantSummary s) text;
  final double? Function(SimSuiteVariantSummary s)? pnl;
}

final List<_SummaryRow> _summaryRows = [
  _SummaryRow('Runs done', (s) => '${s.done}/${s.runs}'),
  _SummaryRow(
    'Mean return',
    (s) => _fmt(s.meanReturnPct, '%'),
    pnl: (s) => s.meanReturnPct,
  ),
  _SummaryRow(
    'Median return',
    (s) => _fmt(s.medianReturnPct, '%'),
    pnl: (s) => s.medianReturnPct,
  ),
  _SummaryRow(
    'P10 to P90',
    (s) => s.p10ReturnPct == null || s.p90ReturnPct == null
        ? simDash
        : '${_fmt(s.p10ReturnPct)} to ${_fmt(s.p90ReturnPct)}',
  ),
  _SummaryRow(
    'Mean excess',
    (s) => _fmt(s.meanExcessPct, ' pts'),
    pnl: (s) => s.meanExcessPct,
  ),
  _SummaryRow(
    'Beat benchmark',
    (s) => s.beatBenchmarkPct == null
        ? simDash
        : '${s.beatBenchmarkPct!.round()}%',
  ),
  _SummaryRow(
    'Worst drawdown',
    (s) => s.worstDrawdownPct == null
        ? simDash
        : '${s.worstDrawdownPct!.toStringAsFixed(2)}%',
  ),
  _SummaryRow(
    'Median Sharpe',
    (s) =>
        s.medianSharpe == null ? simDash : s.medianSharpe!.toStringAsFixed(2),
  ),
  _SummaryRow(
    'Win rate',
    (s) => s.winRatePct == null ? simDash : '${s.winRatePct!.round()}%',
  ),
  _SummaryRow(
    'Avg R',
    (s) => s.avgR == null ? simDash : '${s.avgR!.toStringAsFixed(2)}R',
  ),
  _SummaryRow(
    'Costs',
    (s) => s.costsPct == null ? simDash : '${s.costsPct!.toStringAsFixed(2)}%',
  ),
];

/// Variants side by side: one column per variant (up to three), each row a
/// metric. More variants stack as one card each.
class _SummaryPanel extends StatelessWidget {
  const _SummaryPanel({required this.suite});

  final SimSuite suite;

  Widget _value(
    BuildContext context,
    _SummaryRow row,
    SimSuiteVariantSummary s, {
    TextAlign align = TextAlign.end,
  }) {
    final v = row.pnl?.call(s);
    if (v != null) return PctText(v, size: 13, textAlign: align);
    return Text(
      row.text(s),
      textAlign: align,
      style: LbText.number(context, size: 13),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final summary = suite.summary;
    if (summary.isEmpty) {
      return const Panel(
        title: 'Variant summary',
        child: Text('Summaries appear when the first runs finish.'),
      );
    }
    if (summary.length > 3) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final s in summary) ...[
            Panel(
              title: 'Variant ${s.label}',
              child: KeyValueList(
                rows: [
                  for (final row in _summaryRows)
                    KeyValueRow(
                      row.label,
                      valueWidget: _value(context, row, s),
                    ),
                ],
              ),
            ),
            const SizedBox(height: LbSpace.gap),
          ],
        ],
      );
    }
    return Panel(
      title: 'Variant summary',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Expanded(flex: 4, child: SizedBox.shrink()),
              for (final s in summary)
                Expanded(
                  flex: 3,
                  child: Text(
                    s.label,
                    textAlign: TextAlign.end,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          for (final row in _summaryRows) ...[
            Divider(height: 1, color: c.border),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    flex: 4,
                    child: Text(
                      row.label,
                      style: LbText.muted(context, size: 12.5),
                    ),
                  ),
                  for (final s in summary)
                    Expanded(flex: 3, child: _value(context, row, s)),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ExcessPanel extends StatelessWidget {
  const _ExcessPanel({required this.suite, required this.sim});

  final SimSuite suite;
  final SimState sim;

  @override
  Widget build(BuildContext context) {
    final byId = {for (final r in sim.runs) r.id: r};
    final dots = [
      for (final e in suite.runs)
        ExcessDot(
          id: e.runId,
          label:
              e.scenario ?? (e.seed != null ? 'Bootstrap ${e.seed}' : e.runId),
          variant: e.variant,
          value: byId[e.runId] == null ? null : excessReturn(byId[e.runId]!),
        ),
    ];
    final plotted = dots.where((d) => d.value != null).length;
    return Panel(
      title: 'Excess per run',
      reading: plotted == 0 ? 'No finished runs yet.' : 'Each dot is one run: points above the benchmark to the right of zero, below it to the left.',
      child: ExcessStrip(
        runs: dots,
        variants: suite.config.variants.map((v) => v.label).toList(),
        valueFormatter: (v) => _fmt(v),
        onDotTap: (dot) => AppNav.run(context, dot.id),
      ),
    );
  }
}

class _MarketsPanel extends StatelessWidget {
  const _MarketsPanel({
    required this.suite,
    required this.sim,
    required this.variant,
  });

  final SimSuite suite;
  final SimState sim;
  final String variant;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final strategy = suite.config.variants
        .where((v) => v.label == variant)
        .firstOrNull
        ?.strategy;
    final entries = suite.runs.where((e) => e.variant == variant).toList();
    return Panel(
      title: 'Markets \u00b7 $variant',
      reading: strategy,
      child: entries.isEmpty
          ? Text('No markets yet.', style: LbText.muted(context))
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < entries.length; i++) ...[
                  if (i > 0) const SizedBox(height: 8),
                  Builder(
                    builder: (context) {
                      final e = entries[i];
                      final run = sim.runs
                          .where((r) => r.id == e.runId)
                          .firstOrNull;
                      final label = e.scenario != null
                          ? (sim.scenarios
                                    .where((s) => s.id == e.scenario)
                                    .firstOrNull
                                    ?.name ??
                                e.scenario!)
                          : (e.seed != null ? 'Bootstrap ${e.seed}' : 'Market');
                      final ret = run?.metrics?.returnPct;
                      final border = ret == null
                          ? c.border
                          : (ret > 0
                                ? c.gain.withValues(alpha: 0.4)
                                : (ret < 0
                                      ? c.loss.withValues(alpha: 0.4)
                                      : c.border));
                      return Semantics(
                        button: true,
                        label:
                            'Open $label, return ${ret == null ? 'pending' : pctSigned(ret)}',
                        excludeSemantics: true,
                        child: LbCard(
                          padding: EdgeInsets.zero,
                          borderColor: border,
                          onTap: () => AppNav.run(context, e.runId),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 8,
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        label,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: Theme.of(context)
                                            .textTheme
                                            .titleSmall,
                                      ),
                                      if (e.seed != null)
                                        Text(
                                          'seed ${e.seed}',
                                          style: LbText.number(
                                            context,
                                            size: 11.5,
                                            color: c.mutedForeground,
                                            weight: FontWeight.w400,
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 8),
                                if (ret != null)
                                  PctText(
                                    ret,
                                    size: 13,
                                    weight: FontWeight.w600,
                                  )
                                else
                                  Text(
                                    statusLabel[run?.status ??
                                        SimRunStatus.queued]!,
                                    style: LbText.muted(context, size: 12),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ],
              ],
            ),
    );
  }
}
