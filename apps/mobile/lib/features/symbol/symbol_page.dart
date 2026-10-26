import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'price_chart_panel.dart';
import 'symbol_logic.dart';
import 'symbol_sections.dart';

/// Widest the content grows on tablets; the page stays one readable column.
const double symbolMaxWidth = 720;

/// Full-screen symbol page: price chart, indicators, position, thesis, orders
/// and decisions for one ticker (the web `SymbolSheet`).
class SymbolPage extends ConsumerStatefulWidget {
  const SymbolPage({super.key, required this.symbol});

  final String symbol;

  @override
  ConsumerState<SymbolPage> createState() => _SymbolPageState();
}

class _SymbolPageState extends ConsumerState<SymbolPage> {
  HistoryRange _range = HistoryRange.oneYear;

  HarnessStore get _store => ref.read(harnessProvider.notifier);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  void _load() {
    unawaited(_store.loadHistory(widget.symbol, _range));
    unawaited(_store.loadSymbolDetail(widget.symbol));
  }

  void _setRange(HistoryRange range) {
    setState(() => _range = range);
    unawaited(_store.loadHistory(widget.symbol, range));
  }

  Future<void> _refresh() async {
    _store.retryHistory(widget.symbol, _range);
    await _store.loadSymbolDetail(widget.symbol, force: true);
  }

  @override
  Widget build(BuildContext context) {
    final symbol = widget.symbol;
    ref.listen<bool>(harnessProvider.select((s) => s.loaded), (prev, next) {
      if (next && prev != true) _load();
    });
    final offline = ref.watch(harnessProvider.select((s) => s.connection == ConnectionStatus.offline));
    final detailLoad = ref.watch(harnessProvider.select((s) => s.symbolDetail[symbol]));
    final bars = ref.watch(harnessProvider.select((s) => s.history['$symbol:${historyRangeWire(_range)}']?.data?.bars));
    final held = ref.watch(positionsProvider).where((p) => p.symbol == symbol).firstOrNull;
    final detail = detailLoad?.data;
    final price = detail?.quote?.last ?? bars?.lastOrNull?.close;

    return LbPageScaffold.children(
      title: symbol,
      largeTitle: false,
      onRefresh: _refresh,
      banner: offline ? StaleBanner(onRetry: () => unawaited(_refresh())) : null,
      children: [
        Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: symbolMaxWidth),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Header(symbol: symbol, detail: detail, bars: bars, price: price, range: _range, position: detail?.position ?? held),
                const SizedBox(height: LbSpace.gap),
                PriceChartPanel(symbol: symbol, range: _range, onRangeChanged: _setRange, detail: detail),
                const SizedBox(height: LbSpace.gap),
                LoadableView<SymbolDetail>(
                  loadable: detailLoad,
                  skeletonHeight: 420,
                  onRetry: () => unawaited(_store.loadSymbolDetail(symbol, force: true)),
                  builder: (context, d) => _Sections(detail: d, price: price),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _Sections extends StatelessWidget {
  const _Sections({required this.detail, required this.price});

  final SymbolDetail detail;
  final double? price;

  @override
  Widget build(BuildContext context) {
    final blocks = <Widget>[
      IndicatorsPanel(symbol: detail.symbol, indicators: detail.indicators, price: price),
      if (detail.position != null) PositionPanel(position: detail.position!, stop: detail.stop, price: price),
      if (detail.thesis != null) ThesisPanel(note: detail.thesis!),
      SymbolOrdersPanel(symbol: detail.symbol, orders: detail.orders),
      SymbolJournalPanel(symbol: detail.symbol, entries: detail.journal),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < blocks.length; i++) ...[
          if (i > 0) const SizedBox(height: LbSpace.gap),
          blocks[i],
        ],
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.symbol,
    required this.detail,
    required this.bars,
    required this.price,
    required this.range,
    required this.position,
  });

  final String symbol;
  final SymbolDetail? detail;
  final List<Bar>? bars;
  final double? price;
  final HistoryRange range;
  final Position? position;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final t = Theme.of(context).textTheme;
    final px = price;
    final change = px == null || bars == null ? null : sessionChange(bars!, px);
    final ret = bars == null ? null : periodReturn(bars!);
    final name = detail?.name;
    final earnings = detail?.nextEarnings;
    final p = position;
    return LbCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (name != null) Text(name, style: LbText.muted(context, size: 14)),
          const SizedBox(height: 2),
          Semantics(
            label: px == null ? '$symbol price loading' : '$symbol ${usd(px)}',
            child: ExcludeSemantics(
              child: px == null
                  ? const Align(alignment: Alignment.centerLeft, child: SkeletonBlock(width: 140, height: 34))
                  : FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(usd(px), maxLines: 1, style: LbText.display(context)),
                    ),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 16,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (change != null)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(child: Pnl(amount: change.amount, percent: change.pct, size: 14)),
                    const SizedBox(width: 6),
                    Text('1D', style: LbText.caption(context)),
                  ],
                ),
              if (ret != null)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Pnl(percent: ret, size: 14),
                    const SizedBox(width: 6),
                    Text(historyRangeLabels[range]!, style: LbText.caption(context)),
                  ],
                ),
              if (earnings != null)
                StatusChip(
                  'Earnings ${isoDay(earnings.date)}${earnings.time != null ? ' \u00b7 ${earnings.time}' : ''}',
                  tone: StatusTone.warn,
                ),
            ],
          ),
          if (p != null) ...[
            const SizedBox(height: LbSpace.gap),
            Divider(height: 1, color: c.border),
            const SizedBox(height: 10),
            Semantics(
              container: true,
              label: 'You hold ${qty(p.quantity)} shares worth ${usd(p.marketValue)}',
              child: Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('Held', style: t.labelMedium?.copyWith(color: c.mutedForeground)),
                  Text('${qty(p.quantity)} sh', style: LbText.number(context, size: 13)),
                  Text(usd(p.marketValue), style: LbText.number(context, size: 13)),
                  Pnl(amount: p.unrealizedPnl, size: 13),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
