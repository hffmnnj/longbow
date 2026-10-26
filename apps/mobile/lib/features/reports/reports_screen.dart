import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/reports_calc.dart'
    show groupReportsByWeek, kindLabel, reportPeriodShort;
import 'package:longbow/models/models.dart';

enum _Filter { all, daily, weekly, trade }

String _filterLabel(_Filter f) => switch (f) {
  _Filter.all => 'All',
  _Filter.daily => 'Daily',
  _Filter.weekly => 'Weekly',
  _Filter.trade => 'Trades',
};

bool _matches(_Filter filter, ReportSummary r) =>
    filter == _Filter.all ||
    (filter == _Filter.trade ? r.kind == ReportKind.trade : r.kind.name == filter.name);

String _emptyText(_Filter filter) => switch (filter) {
  _Filter.all =>
    'No reports yet. The agent publishes daily, weekly and trade reports here.',
  _Filter.trade =>
    'No trade reports yet. Closed positions get their own one-page brief.',
  _Filter.daily => 'No daily reports yet.',
  _Filter.weekly => 'No weekly reports yet.',
};

/// The reports list: filter segments, reports grouped by week, one tappable
/// row per report. Port of the web `ReportsView`.
class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  _Filter _filter = _Filter.all;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(harnessProvider.notifier).loadReports());
  }

  Future<void> _refresh() =>
      ref.read(harnessProvider.notifier).loadReports(force: true);

  @override
  Widget build(BuildContext context) {
    final loadable = ref.watch(harnessProvider.select((s) => s.reports));
    final offline =
        ref.watch(harnessProvider.select((s) => s.connection)) ==
        ConnectionStatus.offline;
    final data = loadable.data;

    return LbPageScaffold(
      title: 'Reports',
      onRefresh: _refresh,
      banner:
          offline
              ? StaleBanner(offline: true, onRetry: _refresh)
              : null,
      slivers: [
        if (data == null) ...[
          if (loadable.state == LoadState.error)
            SliverToBoxAdapter(
              child: ErrorState(
                message: 'Could not load reports: ${loadable.error}',
                onRetry: _refresh,
              ),
            )
          else
            const SliverToBoxAdapter(child: _ReportsSkeleton()),
        ] else ...[
          SliverToBoxAdapter(child: _FilterRow(filter: _filter, count: data.length, onChanged: (f) => setState(() => _filter = f))),
          ..._groupSlivers(data),
          if (loadable.error != null)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'Could not refresh: ${loadable.error}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: context.lb.warn,
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }

  List<Widget> _groupSlivers(List<ReportSummary> data) {
    final list = data.where((r) => _matches(_filter, r)).toList();
    if (list.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: Empty(
            title:
                _filter == _Filter.all
                    ? 'No reports yet'
                    : 'No ${_filterLabel(_filter).toLowerCase()} reports',
            message: _emptyText(_filter),
          ),
        ),
      ];
    }
    final groups = groupReportsByWeek(list);
    return [
      for (final g in groups) ...[
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: SectionLabel(g.label),
          ),
        ),
        SliverList.builder(
          itemCount: g.items.length,
          itemBuilder: (context, i) => Padding(
            padding: const EdgeInsets.only(bottom: LbSpace.gap),
            child: _ReportRow(report: g.items[i]),
          ),
        ),
      ],
    ];
  }
}

class _FilterRow extends StatelessWidget {
  const _FilterRow({
    required this.filter,
    required this.count,
    required this.onChanged,
  });

  final _Filter filter;
  final int count;
  final ValueChanged<_Filter> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LbSegmented<_Filter>(
          semanticLabel: 'Report kind',
          selected: filter,
          onChanged: onChanged,
          segments: [
            for (final f in _Filter.values)
              LbSegment(f, _filterLabel(f)),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          '$count report${count == 1 ? '' : 's'}',
          style: LbText.number(
            context,
            size: 12,
            color: context.lb.mutedForeground,
          ),
        ),
      ],
    );
  }
}

class _ReportRow extends StatelessWidget {
  const _ReportRow({required this.report});

  final ReportSummary report;

  @override
  Widget build(BuildContext context) {
    final r = report;
    final kind = kindLabel[r.kind] ?? r.kind.name;
    return LbCard(
      onTap: () => AppNav.report(context, r.id),
      semanticLabel: '$kind report: ${r.headline}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 2,
                  children: [
                    Text(
                      kind.toUpperCase(),
                      style: LbText.caption(
                        context,
                      ).copyWith(fontWeight: FontWeight.w600),
                    ),
                    if (r.kind == ReportKind.trade && r.symbol != null)
                      // Plain text, not a TickerLink: the whole row already
                      // navigates to the report, so a nested link would fight
                      // the row tap.
                      Text(
                        r.symbol!,
                        style: LbText.number(
                          context,
                          size: 12,
                          weight: FontWeight.w600,
                        ),
                      ),
                    Text(
                      reportPeriodShort(r.kind, r.periodStart, r.periodEnd),
                      style: LbText.number(
                        context,
                        size: 12,
                        color: context.lb.mutedForeground,
                      ),
                    ),
                  ],
                ),
              ),
              if (r.grade != null) ...[
                const SizedBox(width: 8),
                GradeChip(r.grade!.name.toUpperCase()),
              ],
            ],
          ),
          const SizedBox(height: 6),
          Text(r.headline, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 4),
          if (r.pnl != null || r.pnlPct != null)
            Pnl(amount: r.pnl, percent: r.pnlPct, size: 13)
          else
            Text('Figures inside', style: LbText.muted(context)),
        ],
      ),
    );
  }
}

class _ReportsSkeleton extends StatelessWidget {
  const _ReportsSkeleton();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SkeletonBlock(width: 220, height: 36),
        const SizedBox(height: LbSpace.gap),
        for (var i = 0; i < 3; i++) ...[
          const LbCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonBlock(width: 160, height: 12),
                SizedBox(height: 8),
                SkeletonBlock(height: 16),
                SizedBox(height: 6),
                SkeletonBlock(width: 110, height: 13),
              ],
            ),
          ),
          const SizedBox(height: LbSpace.gap),
        ],
      ],
    );
  }
}
