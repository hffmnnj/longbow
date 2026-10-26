import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/sim_calc.dart' hide upsertSimRun, upsertSuite;
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'lab_widgets.dart';

/// Line styles for up to five runs. Gain and loss colors are skipped: they
/// mean money. The fifth line repeats lab, dashed.
const List<(ChartTone, bool)> _lineStyles = [
  (ChartTone.lab, false),
  (ChartTone.primary, false),
  (ChartTone.warn, false),
  (ChartTone.muted, false),
  (ChartTone.lab, true),
];

/// Two to five runs side by side: equity indexed to 100 and a metric table.
/// The web CompareView and CompareChart.
class ComparePage extends ConsumerWidget {
  const ComparePage({super.key, required this.runIds});

  final List<String> runIds;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final all = ref.watch(simProvider.select((s) => s.runs));
    final byId = {for (final r in all) r.id: r};
    final runs = [
      for (final id in runIds)
        if (byId[id] != null) byId[id]!,
    ];
    final labels = compareLabels(runs);
    final palette = ChartPalette.of(context);

    return LabTheme(
      child: LbPageScaffold(
        title: 'Compare ${runs.length} runs',
        largeTitle: false,
        actions: const [
          Padding(
            padding: EdgeInsets.only(right: LbSpace.screen),
            child: PaperBadge(),
          ),
        ],
        slivers: [
          SliverToBoxAdapter(
            child: runs.length < 2
                ? const Empty(
                    icon: LbIcons.gitCompare,
                    title: 'Not enough runs',
                    message:
                        'Pick at least two runs from the list to compare them.',
                  )
                : TwoUp(
                    left: [_ChartPanel(runs: runs, labels: labels)],
                    right: [
                      _MetricTable(
                        runs: runs,
                        labels: labels,
                        palette: palette,
                      ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _ChartPanel extends StatelessWidget {
  const _ChartPanel({required this.runs, required this.labels});

  final List<SimRun> runs;
  final List<String> labels;

  @override
  Widget build(BuildContext context) {
    final series = [for (final r in runs) normalizedSeries(r)];
    final longest = series.fold<int>(0, (m, s) => s.length > m ? s.length : m);
    final lines = [
      for (var i = 0; i < runs.length; i++)
        ChartLine(
          values: [for (final p in series[i]) p.value],
          name: labels[i],
          tone: _lineStyles[i % _lineStyles.length].$1,
          dashed: _lineStyles[i % _lineStyles.length].$2,
        ),
    ];
    return Panel(
      title: 'Equity indexed to 100',
      reading: 'Day 0 is the start; every line begins at 100 so runs of different sizes line up.',
      child: MultiLineChart(
        lines: lines,
        labels: [for (var d = 0; d < longest; d++) d == 0 ? 'Start' : 'D$d'],
        referenceLines: const [ChartReferenceLine(value: 100, label: 'Start')],
        valueFormatter: (v) => v.toStringAsFixed(1),
        height: 220,
        semanticsLabel:
            'Equity curves of ${runs.length} runs, indexed to 100 at the start',
      ),
    );
  }
}

class _Cell {
  const _Cell({this.pnl, this.text});
  final double? pnl;
  final String? text;
}

class _MetricTable extends StatelessWidget {
  const _MetricTable({
    required this.runs,
    required this.labels,
    required this.palette,
  });

  final List<SimRun> runs;
  final List<String> labels;
  final ChartPalette palette;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final scaler = MediaQuery.textScalerOf(context);
    final rowRows = [for (final r in runs) metricRows(r)];
    final names = <String>[];
    for (final rows in rowRows) {
      for (final row in rows) {
        if (!names.contains(row.label)) names.add(row.label);
      }
    }
    _Cell cell(int col, String label) {
      final found = rowRows[col].where((r) => r.label == label).firstOrNull;
      if (found == null) return const _Cell(text: simDash);
      if (found.pnl != null) return _Cell(pnl: found.pnl);
      if (found.bars != null) {
        return _Cell(
          text: found.bars!
              .take(2)
              .map((b) => '${b.label} ${b.value}')
              .join(', '),
        );
      }
      return _Cell(text: found.text ?? simDash);
    }

    final labelW = scaler.scale(104);
    final colW = scaler.scale(116);
    final rowH = scaler.scale(40);
    final headH = scaler.scale(56);
    final window = [
      for (final r in runs)
        _Cell(
          text:
              '${r.progress.day}/${r.progress.days}d \u00b7 ${r.progress.cyclesPerDay}/d',
        ),
    ];

    Widget labelCell(String text) => SizedBox(
      height: rowH,
      width: labelW,
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: LbText.muted(context, size: 12.5),
        ),
      ),
    );

    Widget valueCell(_Cell cell) => SizedBox(
      height: rowH,
      width: colW,
      child: Align(
        alignment: Alignment.centerRight,
        child: cell.pnl != null
            ? PctText(cell.pnl!, size: 13)
            : Text(
                cell.text ?? simDash,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.end,
                style: LbText.number(context, size: 13),
              ),
      ),
    );

    final divider = Divider(height: 1, color: c.border);

    return Panel(
      title: 'Metrics side by side',
      padChild: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(LbSpace.card, 0, 0, LbSpace.card),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children:
                  [
                        SizedBox(height: headH, width: labelW),
                        divider,
                        labelCell('Window'),
                        for (final n in names) ...[divider, labelCell(n)],
                      ]
                      .map(
                        (w) => w is Divider
                            ? SizedBox(width: labelW, child: w)
                            : w,
                      )
                      .toList(),
            ),
            Expanded(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.only(right: LbSpace.card),
                child: Column(
                  children: [
                    Row(
                      children: [
                        for (var i = 0; i < runs.length; i++)
                          SizedBox(
                            width: colW,
                            height: headH,
                            child: Padding(
                              padding: const EdgeInsets.only(left: 8),
                              child: Align(
                                alignment: Alignment.centerRight,
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [
                                    Container(
                                      width: 8,
                                      height: 8,
                                      decoration: BoxDecoration(
                                        color: palette.tone(
                                          _lineStyles[i % _lineStyles.length]
                                              .$1,
                                        ),
                                        shape: BoxShape.circle,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Flexible(
                                      child: Text(
                                        labels[i],
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        textAlign: TextAlign.end,
                                        style: Theme.of(context)
                                            .textTheme
                                            .labelMedium,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                    SizedBox(width: colW * runs.length, child: divider),
                    Row(children: [for (final w in window) valueCell(w)]),
                    for (final n in names) ...[
                      SizedBox(width: colW * runs.length, child: divider),
                      Row(
                        children: [
                          for (var i = 0; i < runs.length; i++)
                            valueCell(cell(i, n)),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
