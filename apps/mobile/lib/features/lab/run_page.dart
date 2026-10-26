import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/sim_calc.dart' hide upsertSimRun, upsertSuite;
import 'package:longbow/features/feed/decision_card.dart';
import 'package:longbow/features/feed/order_card.dart';
import 'package:longbow/features/feed/transcript_view.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'lab_widgets.dart';
import 'metrics_grid.dart';

enum _RunSection { overview, trades, agent }

/// One simulation run: header and controls, equity against SPY, metrics,
/// fills and positions, decisions and orders, and the agent transcript.
class RunPage extends ConsumerStatefulWidget {
  const RunPage({super.key, required this.runId});

  final String runId;

  @override
  ConsumerState<RunPage> createState() => _RunPageState();
}

class _RunPageState extends ConsumerState<RunPage> {
  _RunSection _section = _RunSection.overview;
  bool _revealed = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (!mounted) return;
      final store = ref.read(simProvider.notifier);
      if (!ref.read(simProvider).loaded) store.loadRuns();
      store.loadFeed(widget.runId);
    });
  }

  Future<void> _refresh() async {
    final store = ref.read(simProvider.notifier);
    await store.loadRuns();
    await store.loadFeed(widget.runId, true);
  }

  Future<void> _stop(SimRun run) async {
    final ok = await showLbConfirm(
      context,
      title: 'Stop this simulation?',
      message: 'The run ends at its current day. Results so far are kept.',
      confirmLabel: 'Stop run',
      destructive: true,
    );
    if (!ok || !mounted) return;
    Haptics.warning();
    await ref.read(simProvider.notifier).stop(run.id);
  }

  @override
  Widget build(BuildContext context) {
    final id = widget.runId;
    final run = ref.watch(
      simProvider.select((s) => s.runs.where((r) => r.id == id).firstOrNull),
    );
    final loaded = ref.watch(simProvider.select((s) => s.loaded));
    final offline = ref.watch(
      harnessProvider.select((s) => s.connection == ConnectionStatus.offline),
    );

    final Widget body;
    if (run == null) {
      body = loaded
          ? const Empty(
              icon: LbIcons.flaskConical,
              title: 'Run not found',
              message: 'It may have been removed. Go back to the lab list.',
            )
          : const _RunSkeleton();
    } else {
      body = _RunBody(
        run: run,
        section: _section,
        revealed: _revealed,
        onSection: (s) => setState(() => _section = s),
        onReveal: (v) => setState(() => _revealed = v),
        onStop: () => _stop(run),
      );
    }

    return LabTheme(
      child: LbPageScaffold(
        title: 'Simulation',
        largeTitle: false,
        onRefresh: _refresh,
        banner: offline ? StaleBanner(offline: true, onRetry: _refresh) : null,
        slivers: [SliverToBoxAdapter(child: body)],
      ),
    );
  }
}

class _RunSkeleton extends StatelessWidget {
  const _RunSkeleton();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SkeletonBlock(height: 28),
        SizedBox(height: LbSpace.gap),
        SkeletonBlock(height: 18, width: 200),
        SizedBox(height: LbSpace.gap),
        SkeletonBlock(height: 260, radius: LbRadius.lg),
        SizedBox(height: LbSpace.gap),
        SkeletonBlock(height: 180, radius: LbRadius.lg),
      ],
    );
  }
}

class _RunBody extends ConsumerWidget {
  const _RunBody({
    required this.run,
    required this.section,
    required this.revealed,
    required this.onSection,
    required this.onReveal,
    required this.onStop,
  });

  final SimRun run;
  final _RunSection section;
  final bool revealed;
  final ValueChanged<_RunSection> onSection;
  final ValueChanged<bool> onReveal;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feed = ref.watch(simFeedProvider(run.id));
    final feedLoaded = ref.watch(
      simProvider.select((s) => s.feedLoaded[run.id] ?? false),
    );
    final live = isActive(run.status);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Header(
          run: run,
          revealed: revealed,
          onReveal: onReveal,
          onStop: onStop,
        ),
        const SizedBox(height: LbSpace.gap),
        LbSegmented<_RunSection>(
          semanticLabel: 'Run section',
          selected: section,
          onChanged: onSection,
          segments: const [
            LbSegment(_RunSection.overview, 'Overview'),
            LbSegment(_RunSection.trades, 'Trades'),
            LbSegment(_RunSection.agent, 'Agent'),
          ],
        ),
        const SizedBox(height: LbSpace.gap),
        switch (section) {
          _RunSection.overview => TwoUp(
            left: [
              _EquityPanel(run: run, revealed: revealed),
              _ConfigPanel(run: run),
            ],
            right: [MetricsGrid(run: run)],
          ),
          _RunSection.trades => TwoUp(
            left: [_FillsPanel(run: run, revealed: revealed)],
            right: [
              _PositionsPanel(run: run, revealed: revealed),
              _DecisionsPanel(feed: feed, loaded: feedLoaded),
              _OrdersPanel(feed: feed, loaded: feedLoaded),
            ],
          ),
          _RunSection.agent => _AgentSection(
            run: run,
            feed: feed,
            loaded: feedLoaded,
            live: live,
          ),
        },
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.run,
    required this.revealed,
    required this.onReveal,
    required this.onStop,
  });

  final SimRun run;
  final bool revealed;
  final ValueChanged<bool> onReveal;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final t = Theme.of(context).textTheme;
    final live = isActive(run.status);
    final badge = envBadge(run);
    final remaining =
        estimateMinutes(
          run.progress.days - run.progress.day,
          run.progress.cyclesPerDay,
        ) +
        (run.progress.cyclesPerDay - run.progress.cycle + 1) * minutesPerCycle;
    final blindActive =
        run.config.mode != SimMode.historical && !canReveal(run) && live;
    final meta = LbText.number(
      context,
      size: 12,
      color: c.mutedForeground,
      weight: FontWeight.w400,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          header: true,
          child: Text(runTitle(run), style: t.titleMedium),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            const PaperBadge(),
            if (badge != null) LabTag(badge),
            if (run.startedBy == StartedBy.agent)
              const LabTag('By agent', neutral: true),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 14,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            RunStatusLabel(run.status),
            Text(
              'Day ${run.progress.day} of ${run.progress.days}',
              style: meta,
            ),
            if (run.currentDate != null)
              Text(isoShort(run.currentDate!), style: meta),
            if (live)
              Text(
                'Cycle ${run.progress.cycle}/${run.progress.cyclesPerDay}',
                style: meta,
              ),
            Text('${usd(run.config.startingCash)} start', style: meta),
            if (live) Text('${formatEstimate(remaining)} left', style: meta),
          ],
        ),
        if (live) ...[
          const SizedBox(height: 10),
          LabProgress(
            value: progressFraction(run),
            label: 'Simulation progress',
          ),
        ],
        if (run.error != null) ...[
          const SizedBox(height: 10),
          Semantics(
            liveRegion: true,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Color.alphaBlend(c.loss.withValues(alpha: 0.12), c.card),
                borderRadius: BorderRadius.circular(LbRadius.md),
              ),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    LbIcon(LbIcons.alertCircle, size: 18, color: c.loss),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        run.error!,
                        style: t.bodyMedium?.copyWith(color: c.loss),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
        if (run.config.strategy != null &&
            run.config.strategy!.trim().isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(
            run.config.strategy!,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
            style: LbText.muted(context),
          ),
        ],
        if (blindActive) ...[
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LbIcon(LbIcons.lock, size: 16, color: c.mutedForeground),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Tickers stay aliased until the run ends, so memory of real events cannot help.',
                  style: LbText.muted(context, size: 12.5),
                ),
              ),
            ],
          ),
        ],
        if (canReveal(run)) ...[
          const SizedBox(height: 4),
          LbSwitchRow(
            title: 'Reveal tickers',
            subtitle: revealed ? 'Showing real symbols' : 'Showing aliases',
            value: revealed,
            onChanged: onReveal,
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
  }
}

String _signedPct(double v) => pctSigned(v);

class _EquityPanel extends StatelessWidget {
  const _EquityPanel({required this.run, required this.revealed});

  final SimRun run;
  final bool revealed;

  @override
  Widget build(BuildContext context) {
    final base = run.config.startingCash;
    final n = runNumbers(run);
    final last = run.equity.isEmpty ? null : run.equity.last;
    final dayIndex = {
      for (var i = 0; i < run.equity.length; i++) run.equity[i].date: i + 1,
    };
    final groups = <String, ChartMarker>{};
    for (final f in run.fills) {
      final idx = dayIndex[f.date];
      if (idx == null) continue;
      final key = '${f.date}:${f.side.name}';
      final existing = groups[key];
      if (existing == null) {
        groups[key] = ChartMarker(
          index: idx,
          kind: f.side == OrderSide.buy
              ? ChartMarkerKind.buy
              : ChartMarkerKind.sell,
          label: '${f.side.name} ${shownSymbol(run, f.symbol, revealed)}',
        );
      }
    }
    return Panel(
      title: 'Equity against SPY',
      reading: n == null
          ? null
          : 'Returned ${_signedPct(n.returnPct)} against SPY ${_signedPct(n.benchmarkReturnPct)} over ${run.equity.length} of ${run.progress.days} days.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (run.equity.isEmpty)
            SizedBox(
              height: 200,
              child: Center(
                child: Text(
                  'Waiting for the first close',
                  style: LbText.muted(context, size: 14),
                ),
              ),
            )
          else
            DitherAreaChart(
              values: [base, ...run.equity.map((p) => p.equity)],
              benchmark: [base, ...run.equity.map((p) => p.benchmark)],
              labels: ['Start', ...run.equity.map((p) => isoShort(p.date))],
              name: 'Equity',
              benchmarkName: 'SPY',
              tone: ChartTone.lab,
              referenceLines: [ChartReferenceLine(value: base, label: 'Start')],
              markers: groups.values.toList(),
              valueFormatter: usd0,
              height: 220,
              semanticsLabel:
                  'Equity against SPY over ${run.equity.length} days, ending at ${usd(last!.equity)} against ${usd(last.benchmark)}',
            ),
          if (last != null) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 16,
              runSpacing: 4,
              children: [
                _Legend(
                  color: context.lb.lab,
                  label: 'Equity',
                  value: usd(last.equity),
                ),
                _Legend(
                  color: context.lb.mutedForeground,
                  label: 'SPY',
                  value: usd(last.benchmark),
                  dashed: true,
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({
    required this.color,
    required this.label,
    required this.value,
    this.dashed = false,
  });

  final Color color;
  final String label;
  final String value;
  final bool dashed;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 16,
          height: 2,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: dashed ? color.withValues(alpha: 0.6) : color,
            ),
          ),
        ),
        const SizedBox(width: 6),
        Flexible(
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: '$label ',
                  style: LbText.muted(context, size: 12),
                ),
                TextSpan(
                  text: value,
                  style: LbText.number(context, size: 12.5),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ConfigPanel extends StatelessWidget {
  const _ConfigPanel({required this.run});

  final SimRun run;

  @override
  Widget build(BuildContext context) {
    final cfg = run.config;
    final mode = switch (cfg.mode) {
      SimMode.historical => 'Historical',
      SimMode.blind => 'Blind',
      SimMode.bootstrap => 'Bootstrap',
    };
    return Panel(
      title: 'Setup',
      child: KeyValueList(
        rows: [
          KeyValueRow('Environment', value: mode),
          KeyValueRow(
            'Execution',
            value: cfg.execution == SimExecution.realistic
                ? 'Realistic'
                : 'Ideal',
          ),
          KeyValueRow(
            'Model',
            value: cfg.model == SimModel.main ? 'Lead' : 'Subagent',
          ),
          KeyValueRow('Cycles per day', value: '${cfg.cyclesPerDay}'),
          if (run.seed != null) KeyValueRow('Seed', value: '${run.seed}'),
          if (cfg.scenario != null)
            KeyValueRow('Scenario', value: cfg.scenario!, mono: false),
          if (cfg.mode == SimMode.historical && cfg.startDate != null)
            KeyValueRow('Start date', value: cfg.startDate!),
          if (run.calendar != null)
            KeyValueRow('Calendar from', value: run.calendar!.firstDay),
          if (cfg.watchlist != null && cfg.watchlist!.isNotEmpty)
            KeyValueRow('Watchlist', value: cfg.watchlist!.join(' ')),
        ],
      ),
    );
  }
}

/// Symbol text; tappable only when the symbol is a real ticker.
class _Sym extends StatelessWidget {
  const _Sym({required this.run, required this.symbol, required this.revealed});

  final SimRun run;
  final String symbol;
  final bool revealed;

  @override
  Widget build(BuildContext context) {
    final shown = shownSymbol(run, symbol, revealed);
    final real =
        run.config.mode == SimMode.historical || (revealed && shown != symbol);
    if (real) return TickerLink(shown);
    return Text(
      shown,
      style: LbText.number(context, size: 14, weight: FontWeight.w600),
    );
  }
}

/// A list that shows the first [step] rows and a "Show more" button.
class _Capped extends StatefulWidget {
  const _Capped({required this.count, required this.builder, this.step = 20});

  final int count;
  final int step;
  final Widget Function(BuildContext context, int index) builder;

  @override
  State<_Capped> createState() => _CappedState();
}

class _CappedState extends State<_Capped> {
  late int _shown = widget.step;

  @override
  Widget build(BuildContext context) {
    final n = math.min(_shown, widget.count);
    final c = context.lb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < n; i++) ...[
          if (i > 0) Divider(height: 1, color: c.border),
          widget.builder(context, i),
        ],
        if (n < widget.count)
          TextButton(
            onPressed: () => setState(() => _shown += widget.step),
            child: Text('Show more (${widget.count - n} left)'),
          ),
      ],
    );
  }
}

class _FillsPanel extends StatelessWidget {
  const _FillsPanel({required this.run, required this.revealed});

  final SimRun run;
  final bool revealed;

  @override
  Widget build(BuildContext context) {
    final fills = run.fills.reversed.toList();
    final c = context.lb;
    return Panel(
      title: 'Fills \u00b7 ${fills.length}',
      padChild: false,
      child: fills.isEmpty
          ? const Empty(title: 'No fills yet', icon: LbIcons.note01)
          : Padding(
              padding: const EdgeInsets.fromLTRB(
                LbSpace.card,
                0,
                LbSpace.card,
                8,
              ),
              child: _Capped(
                count: fills.length,
                builder: (context, i) {
                  final f = fills[i];
                  final cost = fillCost(f);
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Wrap(
                                spacing: 8,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  SideBadge(f.side.name),
                                  _Sym(
                                    run: run,
                                    symbol: f.symbol,
                                    revealed: revealed,
                                  ),
                                  Text(
                                    '${qty(f.quantity)} @ ${usd(f.price)}',
                                    style: LbText.number(context, size: 13),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                [
                                  isoShort(f.date),
                                  if (cost != null)
                                    'costs ${usd(cost)}${f.fees != null && f.fees! > 0 ? ' incl. ${usd(f.fees!)} fees' : ''}',
                                ].join(' \u00b7 '),
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
                        Money(f.quantity * f.price, size: 13),
                      ],
                    ),
                  );
                },
              ),
            ),
    );
  }
}

class _PositionsPanel extends StatelessWidget {
  const _PositionsPanel({required this.run, required this.revealed});

  final SimRun run;
  final bool revealed;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Panel(
      title: 'Positions \u00b7 ${run.positions.length}',
      padChild: false,
      child: run.positions.isEmpty
          ? const Empty(
              title: 'Flat. No open positions',
              icon: LbIcons.briefcase01,
            )
          : Padding(
              padding: const EdgeInsets.fromLTRB(
                LbSpace.card,
                0,
                LbSpace.card,
                8,
              ),
              child: Column(
                children: [
                  for (var i = 0; i < run.positions.length; i++) ...[
                    if (i > 0) Divider(height: 1, color: c.border),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                _Sym(
                                  run: run,
                                  symbol: run.positions[i].symbol,
                                  revealed: revealed,
                                ),
                                Text(
                                  '${qty(run.positions[i].quantity)} @ ${usd(run.positions[i].averageCost)}',
                                  style: LbText.number(
                                    context,
                                    size: 12,
                                    color: c.mutedForeground,
                                    weight: FontWeight.w400,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Money(run.positions[i].marketValue, size: 13),
                              Pnl(
                                amount: run.positions[i].unrealizedPnl,
                                size: 12,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
    );
  }
}

class _DecisionsPanel extends StatelessWidget {
  const _DecisionsPanel({required this.feed, required this.loaded});

  final FeedState feed;
  final bool loaded;

  @override
  Widget build(BuildContext context) {
    final entries = feed.journal.reversed.toList();
    return Panel(
      title: 'Decisions${loaded ? ' \u00b7 ${entries.length}' : ''}',
      child: !loaded
          ? const SkeletonLines(lines: 3)
          : entries.isEmpty
          ? Text('No decisions yet.', style: LbText.muted(context))
          : _Capped(
              count: entries.length,
              step: 10,
              builder: (context, i) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: DecisionCard(entry: entries[i]),
              ),
            ),
    );
  }
}

class _OrdersPanel extends StatelessWidget {
  const _OrdersPanel({required this.feed, required this.loaded});

  final FeedState feed;
  final bool loaded;

  @override
  Widget build(BuildContext context) {
    final orders = feed.orders.reversed.toList();
    return Panel(
      title: 'Orders${loaded ? ' \u00b7 ${orders.length}' : ''}',
      child: !loaded
          ? const SkeletonLines(lines: 3)
          : orders.isEmpty
          ? Text('No orders yet.', style: LbText.muted(context))
          : _Capped(
              count: orders.length,
              step: 10,
              builder: (context, i) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: OrderCard(order: orders[i]),
              ),
            ),
    );
  }
}

class _AgentSection extends ConsumerWidget {
  const _AgentSection({
    required this.run,
    required this.feed,
    required this.loaded,
    required this.live,
  });

  final SimRun run;
  final FeedState feed;
  final bool loaded;
  final bool live;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!loaded) {
      return const Panel(
        title: 'Simulated agent',
        child: SkeletonLines(lines: 5),
      );
    }
    if (feed.messages.isEmpty && feed.draft.isEmpty) {
      return Empty(
        icon: LbIcons.aiBrain01,
        title: live
            ? 'Waiting for the first cycle'
            : 'This run has no agent messages',
      );
    }
    final height = math.max(360.0, MediaQuery.sizeOf(context).height * 0.7);
    final store = ref.read(simProvider.notifier);
    return Semantics(
      container: true,
      label: 'Simulated agent feed',
      child: SizedBox(
        height: height,
        child: FeedTranscriptView(
          feed: feed,
          simRunId: run.id,
          loadTranscript: (conversationId) =>
              store.loadTranscript(run.id, conversationId),
        ),
      ),
    );
  }
}
