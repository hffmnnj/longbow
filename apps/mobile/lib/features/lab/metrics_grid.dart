import 'package:flutter/material.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/domain/sim_calc.dart' hide upsertSimRun, upsertSuite;
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

/// The run's metrics, grouped (return and risk, trading, costs, discipline).
/// Undefined metrics are omitted, never dashed. Risk blocks render as bars.
class MetricsGrid extends StatelessWidget {
  const MetricsGrid({super.key, required this.run});

  final SimRun run;

  @override
  Widget build(BuildContext context) {
    final groups = metricGroups(run);
    if (groups.isEmpty) {
      return const Panel(
        title: 'Metrics',
        child: Text('No metrics yet. They appear after the first close.'),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < groups.length; i++) ...[
          if (i > 0) const SizedBox(height: LbSpace.gap),
          _Group(group: groups[i]),
        ],
      ],
    );
  }
}

class _Group extends StatelessWidget {
  const _Group({required this.group});

  final MetricGroup group;

  @override
  Widget build(BuildContext context) {
    final cells = group.rows.where((r) => r.bars == null).toList();
    final bars = group.rows.where((r) => r.bars != null).toList();
    return Panel(
      title: group.title,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (cells.isNotEmpty)
            LayoutBuilder(
              builder: (context, box) {
                const gap = 12.0;
                final cols = box.maxWidth >= 520 ? 3 : 2;
                final w = (box.maxWidth - gap * (cols - 1)) / cols;
                return Wrap(
                  spacing: gap,
                  runSpacing: gap,
                  children: [
                    for (final r in cells)
                      SizedBox(
                        width: w,
                        child: _Cell(row: r),
                      ),
                  ],
                );
              },
            ),
          for (final r in bars) ...[
            if (cells.isNotEmpty) const SizedBox(height: LbSpace.gap),
            _BarsCell(row: r),
          ],
        ],
      ),
    );
  }
}

class _Cell extends StatelessWidget {
  const _Cell({required this.row});

  final MetricRow row;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(row.label, style: LbText.muted(context, size: 12)),
          const SizedBox(height: 2),
          if (row.pnl != null)
            PctText(row.pnl!, size: 16, weight: FontWeight.w600)
          else
            Text(
              row.text ?? simDash,
              style: LbText.number(context, size: 16, weight: FontWeight.w600),
            ),
          if (row.sub != null)
            Text(
              row.sub!,
              style: LbText.number(
                context,
                size: 11.5,
                color: c.mutedForeground,
                weight: FontWeight.w400,
              ),
            ),
        ],
      ),
    );
  }
}

class _BarsCell extends StatelessWidget {
  const _BarsCell({required this.row});

  final MetricRow row;

  @override
  Widget build(BuildContext context) {
    final bars = row.bars!;
    final maxBlock = bars.fold<int>(0, (m, b) => b.value > m ? b.value : m);
    return Semantics(
      container: true,
      label:
          '${row.label}: ${bars.map((b) => '${b.label} ${b.value}').join(', ')}',
      child: ExcludeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(row.label, style: LbText.muted(context, size: 12)),
            const SizedBox(height: 6),
            for (final b in bars.take(6))
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    Expanded(
                      flex: 5,
                      child: Text(
                        b.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: LbText.number(
                          context,
                          size: 11.5,
                          color: context.lb.mutedForeground,
                          weight: FontWeight.w400,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 6,
                      child: BarStrip(
                        value: b.value.toDouble(),
                        max: maxBlock == 0 ? 1 : maxBlock.toDouble(),
                        tone: ChartTone.lab,
                        height: 8,
                        semanticsLabel: '${b.label} ${b.value}',
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 28,
                      child: Text(
                        '${b.value}',
                        textAlign: TextAlign.end,
                        style: LbText.number(context, size: 12),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
