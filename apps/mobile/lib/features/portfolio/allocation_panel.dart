import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/analytics_calc.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'portfolio_logic.dart';

/// Where the money sits (a stacked strip of position weights and cash) and
/// how much of it is at risk if every stop is hit.
class AllocationPanel extends ConsumerWidget {
  const AllocationPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(harnessProvider.select((s) => s.feed.status));
    final perf = ref.watch(harnessProvider.select((s) => s.performance));
    final account = status?.account;
    if (status == null) return const SkeletonBlock(height: 150, radius: LbRadius.lg);
    if (account == null || account.equity <= 0) {
      return const Panel(title: 'Allocation', child: Text('Nothing to allocate until the account is connected.'));
    }
    final rows = positionStops(account.positions, perf.data?.exposure ?? const [], account.equity);
    final slices = allocationSlices(rows, account.equity, account.cash);
    final invested = account.positions.fold<double>(0, (a, p) => a + p.marketValue) / account.equity * 100;
    final cash = account.cash / account.equity * 100;
    final reading = account.positions.isEmpty
        ? 'All cash: nothing is at risk.'
        : '${pct(invested)} invested across ${account.positions.length} ${account.positions.length == 1 ? 'name' : 'names'}; ${pct(cash)} cash';
    return Panel(
      title: 'Allocation',
      reading: reading,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AllocationStrip(slices: slices),
          const SizedBox(height: LbSpace.gap),
          _Heat(perf: perf, risk: status.settings.risk, hasPositions: account.positions.isNotEmpty),
        ],
      ),
    );
  }
}

class _Heat extends ConsumerWidget {
  const _Heat({required this.perf, required this.risk, required this.hasPositions});

  final Loadable<PerformanceSummary> perf;
  final RiskConfig risk;
  final bool hasPositions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!hasPositions) return const SizedBox.shrink();
    final data = perf.data;
    if (data == null) {
      if (perf.state == LoadState.error) {
        return Row(
          children: [
            Expanded(child: Text('Could not load risk: ${perf.error}', style: LbText.muted(context, size: 12))),
            TextButton(onPressed: () => ref.read(harnessProvider.notifier).loadPerformance(force: true), child: const Text('Retry')),
          ],
        );
      }
      return const SkeletonBlock(height: 34);
    }
    final heat = data.heatPct;
    final cap = heatCapPct(risk);
    if (heat == null || cap <= 0) {
      return Text('No stops to measure yet.', style: LbText.muted(context));
    }
    final ratio = heat / cap;
    final tone = ratio > 0.85 ? ChartTone.loss : (ratio > 0.6 ? ChartTone.warn : ChartTone.primary);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${pct(heat)} of equity is at risk if every stop is hit, against a ${pct(cap)} cap',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 8),
        BarStrip(
          value: heat,
          max: cap,
          tone: tone,
          semanticsLabel: 'Portfolio heat ${pct(heat)} of a ${pct(cap)} cap',
        ),
      ],
    );
  }
}

/// One horizontal strip split by weight, with a legend. Segment colours step
/// down from the primary accent; cash is muted so it never reads as a holding.
class AllocationStrip extends StatelessWidget {
  const AllocationStrip({super.key, required this.slices});

  final List<AllocSlice> slices;

  Color _color(LongbowColors c, AllocSlice s, int i) {
    if (s.isCash) return c.mutedForeground.withValues(alpha: 0.3);
    if (s.isOther) return c.mutedForeground.withValues(alpha: 0.6);
    const steps = [1.0, 0.72, 0.52, 0.38];
    return c.primary.withValues(alpha: steps[i.clamp(0, steps.length - 1)]);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final summary = slices.map((s) => '${s.label} ${pct(s.weightPct)}').join(', ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          image: true,
          label: 'Allocation: $summary',
          child: ExcludeSemantics(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(LbRadius.sm),
              child: SizedBox(
                height: 14,
                child: Row(
                  children: [
                    for (var i = 0; i < slices.length; i++) ...[
                      if (i > 0) SizedBox(width: 1.5, child: ColoredBox(color: c.card)),
                      Expanded(
                        flex: (slices[i].weightPct * 100).round().clamp(1, 1000000),
                        child: ColoredBox(color: _color(c, slices[i], i)),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        ExcludeSemantics(
          child: Wrap(
            spacing: 14,
            runSpacing: 6,
            children: [
              for (var i = 0; i < slices.length; i++)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(color: _color(c, slices[i], i), borderRadius: BorderRadius.circular(2)),
                    ),
                    const SizedBox(width: 6),
                    Text(slices[i].label, style: LbText.number(context, size: 12, weight: FontWeight.w600)),
                    const SizedBox(width: 4),
                    Text(pct(slices[i].weightPct), style: LbText.number(context, size: 12, color: c.mutedForeground)),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }
}
