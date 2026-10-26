import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/domain/sim_calc.dart' hide upsertSimRun, upsertSuite;
import 'package:longbow/models/models.dart';

import 'lab_widgets.dart';

/// "Day 3 of 10 · Mar 4 · cycle 1/2" while live, else "8 of 10 days · from Mar 1".
String runWhere(SimRun run) {
  if (isActive(run.status)) {
    final date = run.currentDate != null
        ? ' \u00b7 ${isoShort(run.currentDate!)}'
        : '';
    return 'Day ${run.progress.day} of ${run.progress.days}$date \u00b7 cycle ${run.progress.cycle}/${run.progress.cyclesPerDay}';
  }
  final from = run.config.startDate != null
      ? ' \u00b7 from ${isoShort(run.config.startDate!)}'
      : run.config.mode == SimMode.bootstrap
      ? ' \u00b7 bootstrap'
      : '';
  return '${run.equity.length} of ${run.progress.days} days$from';
}

/// One run in the lab list: tick to compare, tap to open.
class RunCard extends StatelessWidget {
  const RunCard({
    super.key,
    required this.run,
    required this.selected,
    required this.onOpen,
    required this.onToggle,
  });

  final SimRun run;
  final bool selected;
  final VoidCallback onOpen;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final t = Theme.of(context).textTheme;
    final numbers = runNumbers(run);
    final live = isActive(run.status);
    final title = runTitle(run);
    return LbCard(
      padding: EdgeInsets.zero,
      color: selected ? c.labBg : null,
      borderColor: selected ? c.lab.withValues(alpha: 0.6) : null,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: kMinTarget,
            child: Semantics(
              label: 'Compare $title',
              child: Checkbox(
                value: selected,
                onChanged: (_) => onToggle(),
                activeColor: c.lab,
                checkColor: c.background,
              ),
            ),
          ),
          Expanded(
            child: InkWell(
              onTap: onOpen,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: kMinTarget),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(0, 12, 12, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: t.titleSmall,
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 10,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          RunStatusLabel(run.status),
                          if (envBadge(run) != null) LabTag(envBadge(run)!),
                          if (run.startedBy == StartedBy.agent)
                            const LabTag('By agent', neutral: true),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        runWhere(run),
                        style: LbText.number(
                          context,
                          size: 11.5,
                          color: c.mutedForeground,
                          weight: FontWeight.w400,
                        ),
                      ),
                      if (live) ...[
                        const SizedBox(height: 8),
                        LabProgress(
                          value: progressFraction(run),
                          label: 'Simulation progress',
                        ),
                      ],
                      const SizedBox(height: 8),
                      RunSpark(run: run),
                      const SizedBox(height: 8),
                      if (numbers == null)
                        Text(
                          'No closes yet',
                          style: LbText.muted(context, size: 12),
                        )
                      else
                        Wrap(
                          spacing: 16,
                          runSpacing: 4,
                          children: [
                            _Fig(
                              'Return',
                              PctText(
                                numbers.returnPct,
                                size: 13,
                                weight: FontWeight.w600,
                              ),
                            ),
                            _Fig(
                              'SPY',
                              PctText(numbers.benchmarkReturnPct, size: 13),
                            ),
                            _Fig(
                              'Max DD',
                              Text(
                                '${numbers.maxDrawdownPct.toStringAsFixed(2)}%',
                                style: LbText.number(context, size: 13),
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Fig extends StatelessWidget {
  const _Fig(this.label, this.value);
  final String label;
  final Widget value;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: LbText.muted(context, size: 11.5)),
        value,
      ],
    );
  }
}

/// One suite in the lab list: variants, progress, the verdict if any.
class SuiteCard extends StatelessWidget {
  const SuiteCard({
    super.key,
    required this.suite,
    required this.runs,
    required this.onOpen,
  });

  final SimSuite suite;
  final List<SimRun> runs;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final t = Theme.of(context).textTheme;
    final progress = suiteProgress(suite, runs);
    final live = isActive(suite.status);
    final labels = suite.config.variants.map((v) => v.label).toList();
    final cmp = suite.comparison;
    Widget? verdict;
    if (cmp != null && labels.length >= 2) {
      final d = cmp.meanDiff;
      final leader = d == 0 ? 'Tied' : (d > 0 ? labels[1] : labels[0]);
      final trailer = d > 0 ? labels[0] : labels[1];
      final tone = d > 0 ? c.gain : (d < 0 ? c.loss : c.mutedForeground);
      final head = d == 0
          ? leader
          : '$leader +${d.abs().toStringAsFixed(1)} vs $trailer';
      verdict = Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: head,
              style: TextStyle(color: tone, fontWeight: FontWeight.w600),
            ),
            TextSpan(
              text:
                  ' \u00b7 excess, 95% ${cmp.ci95[0].toStringAsFixed(1)} to ${cmp.ci95[1].toStringAsFixed(1)}',
              style: TextStyle(color: c.mutedForeground),
            ),
          ],
        ),
        style: LbText.number(context, size: 12, weight: FontWeight.w400),
      );
    }
    return LbCard(
      onTap: onOpen,
      semanticLabel: 'Open suite ${suite.config.name}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            suite.config.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: t.titleSmall,
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 10,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              RunStatusLabel(suite.status),
              if (suite.startedBy == StartedBy.agent)
                const LabTag('By agent', neutral: true),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${progress.done} of ${progress.total} runs done${labels.isEmpty ? '' : ' \u00b7 ${labels.join(' vs ')}'}',
            style: LbText.number(
              context,
              size: 11.5,
              color: c.mutedForeground,
              weight: FontWeight.w400,
            ),
          ),
          if (live && progress.total > 0) ...[
            const SizedBox(height: 8),
            LabProgress(
              value: progress.done / progress.total,
              label: 'Suite progress',
            ),
          ],
          if (verdict != null) ...[const SizedBox(height: 8), verdict],
        ],
      ),
    );
  }
}
