import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/models/models.dart';

import 'allocation_panel.dart';
import 'equity_chart_panel.dart';
import 'equity_hero.dart';
import 'latest_report_card.dart';
import 'open_orders_panel.dart';
import 'positions_panel.dart';

/// Width at which the blocks split into two columns.
const double portfolioTwoColumnWidth = 840;

/// The Portfolio tab: equity verdict, equity against SPY, allocation and risk,
/// positions, open orders and the latest report. Every block loads on its own.
class PortfolioScreen extends ConsumerStatefulWidget {
  const PortfolioScreen({super.key, this.onSeeAllOrders});

  /// Opens Journal and orders; the "see all" link is hidden when null.
  final VoidCallback? onSeeAllOrders;

  @override
  ConsumerState<PortfolioScreen> createState() => _PortfolioScreenState();
}

class _PortfolioScreenState extends ConsumerState<PortfolioScreen> {
  AnalyticsRange _range = AnalyticsRange.threeMonths;

  HarnessStore get _store => ref.read(harnessProvider.notifier);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  void _load({bool force = false}) {
    unawaited(_store.loadEquity(_range, force: force));
    unawaited(_store.loadPerformance(force: force));
    unawaited(_store.loadReports(force: force));
  }

  void _setRange(AnalyticsRange range) {
    setState(() => _range = range);
    unawaited(_store.loadEquity(range));
  }

  Future<void> _refresh() async {
    await Future.wait([
      _store.refresh(),
      _store.loadEquity(_range, force: true),
      _store.loadPerformance(force: true),
      _store.loadReports(force: true),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<bool>(harnessProvider.select((s) => s.loaded), (prev, next) {
      if (next && prev != true) _load();
    });
    final offline = ref.watch(harnessProvider.select((s) => s.connection == ConnectionStatus.offline));
    final cachedAt = ref.watch(harnessProvider.select((s) => s.cachedAt));
    final accountAt = ref.watch(harnessProvider.select((s) => s.feed.status?.account?.at));

    final hero = const EquityHero();
    final chart = EquityChartPanel(range: _range, onRangeChanged: _setRange);
    const positions = PositionsPanel();
    const allocation = AllocationPanel();
    final orders = OpenOrdersPanel(onSeeAll: widget.onSeeAllOrders);
    const report = LatestReportCard();

    Widget stack(List<Widget> blocks) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < blocks.length; i++) ...[
              if (i > 0) const SizedBox(height: LbSpace.gap),
              blocks[i],
            ],
          ],
        );

    return LbTabBody(
      onRefresh: _refresh,
      slivers: [
        if (offline || cachedAt != null)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: LbSpace.gap),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(LbRadius.md),
                child: StaleBanner(
                  offline: offline,
                  updatedAtMs: cachedAt ?? accountAt,
                  onRetry: () => unawaited(_refresh()),
                ),
              ),
            ),
          ),
        SliverToBoxAdapter(
          child: LayoutBuilder(
            builder: (context, box) {
              if (box.maxWidth + 2 * LbSpace.screen >= portfolioTwoColumnWidth) {
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 3, child: stack([hero, chart, positions])),
                    const SizedBox(width: LbSpace.gap),
                    Expanded(flex: 2, child: stack([report, allocation, orders])),
                  ],
                );
              }
              return stack([hero, chart, allocation, positions, orders, report]);
            },
          ),
        ),
      ],
    );
  }
}
