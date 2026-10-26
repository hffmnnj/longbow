import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/reports_calc.dart';

/// The newest published report: headline, grade and result. Hidden when there
/// is none.
class LatestReportCard extends ConsumerWidget {
  const LatestReportCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reports = ref.watch(harnessProvider.select((s) => s.reports));
    final latest = ref.watch(latestReportProvider);
    if (latest == null) {
      if (reports.state == LoadState.error) {
        return LbCard(
          child: Row(
            children: [
              Expanded(child: Text('Could not load reports: ${reports.error}', style: LbText.muted(context, size: 12))),
              TextButton(
                onPressed: () => ref.read(harnessProvider.notifier).loadReports(force: true),
                child: const Text('Retry'),
              ),
            ],
          ),
        );
      }
      if (reports.data == null) return const SkeletonBlock(height: 96, radius: LbRadius.lg);
      return const SizedBox.shrink();
    }
    final c = context.lb;
    final r = latest;
    final hasFigures = r.pnl != null || r.pnlPct != null;
    return LbCard(
      onTap: () => AppNav.report(context, r.id),
      semanticLabel: 'Latest report: ${r.headline}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              LbIcon(LbIcons.news01, size: 16, color: c.mutedForeground),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Latest report \u00b7 ${kindLabel[r.kind]} \u00b7 ${reportPeriodShort(r.kind, r.periodStart, r.periodEnd)}',
                  style: LbText.caption(context),
                ),
              ),
              if (r.grade != null) ...[
                const SizedBox(width: 8),
                GradeChip(r.grade!.name.toUpperCase()),
              ],
            ],
          ),
          const SizedBox(height: 6),
          Text(
            r.headline,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: hasFigures
                    ? Align(alignment: Alignment.centerLeft, child: Pnl(amount: r.pnl, percent: r.pnlPct, size: 13))
                    : Text('Figures inside', style: LbText.muted(context)),
              ),
              Text('Read', style: Theme.of(context).textTheme.labelMedium?.copyWith(color: c.primary)),
              const SizedBox(width: 2),
              LbIcon(LbIcons.arrowRight01, size: 14, color: c.primary),
            ],
          ),
        ],
      ),
    );
  }
}
