import 'package:flutter/material.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

/// The phone port of the web `TrendTable`: one two-line row per symbol.
/// Tapping the ticker opens its chart. Secondary columns collapse into a
/// compact indicator strip so nothing scrolls sideways.
class TrendList extends StatelessWidget {
  const TrendList({
    super.key,
    required this.rows,
    required this.relative,
    this.held = const {},
  });

  /// Server order (best first for sectors).
  final List<TrendRow> rows;

  /// Show 3-month strength against SPY, for the sector list.
  final bool relative;
  final Set<String> held;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < rows.length; i++) ...[
          if (i > 0) const Divider(height: 1),
          _TrendRow(row: rows[i], relative: relative, held: held),
        ],
      ],
    );
  }
}

class _TrendRow extends StatelessWidget {
  const _TrendRow({
    required this.row,
    required this.relative,
    required this.held,
  });

  final TrendRow row;
  final bool relative;
  final Set<String> held;

  @override
  Widget build(BuildContext context) {
    final isHeld = held.contains(row.symbol);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              TickerLink(row.symbol),
              const SizedBox(width: 8),
              Expanded(
                child: Row(
                  children: [
                    Flexible(
                      child: Text(
                        row.name ?? '',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: LbText.muted(context, size: 12),
                      ),
                    ),
                    if (isHeld) ...[
                      const SizedBox(width: 6),
                      Flexible(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: const StatusChip(
                            'Held',
                            tone: StatusTone.live,
                            showIcon: false,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerRight,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Money(row.last, size: 14),
                      Pnl(percent: row.changePct1d, size: 12),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Sparkline(
                values: row.spark,
                width: 96,
                height: 28,
                semanticsLabel: '${row.symbol} three month trend',
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Wrap(
                  spacing: 10,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _TenorReturn(tenor: '1M', value: row.return1m),
                    _TenorReturn(tenor: '3M', value: row.return3m),
                    _SmaFlag(above: row.aboveSma50, label: '50d'),
                    _SmaFlag(above: row.aboveSma200, label: '200d'),
                    if (row.rsi14 != null)
                      Text(
                        'RSI ${row.rsi14!.toStringAsFixed(0)}',
                        style: LbText.number(
                          context,
                          size: 12,
                          color: context.lb.mutedForeground,
                        ),
                      ),
                    if (relative && row.relStrength3m != null)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'vs SPY',
                            style: LbText.muted(context, size: 12),
                          ),
                          const SizedBox(width: 4),
                          PctText(row.relStrength3m!, size: 12),
                        ],
                      ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A labeled 1- or 3-month return, e.g. "1M +2.40%".
class _TenorReturn extends StatelessWidget {
  const _TenorReturn({required this.tenor, required this.value});

  final String tenor;
  final double value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(tenor, style: LbText.muted(context, size: 12)),
        const SizedBox(width: 3),
        Flexible(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: PctText(value, size: 12),
          ),
        ),
      ],
    );
  }
}

/// Above or below a moving average: an arrow plus the tenor, in gain or loss,
/// announced as a sentence so color is never the only signal.
class _SmaFlag extends StatelessWidget {
  const _SmaFlag({required this.above, required this.label});

  final bool above;
  final String label;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final color = above ? c.gain : c.loss;
    return Semantics(
      label: above
          ? 'Above its $label moving average'
          : 'Below its $label moving average',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          LbIcon(
            above ? LbIcons.arrowUp02 : LbIcons.arrowDown01,
            size: 12,
            color: color,
          ),
          const SizedBox(width: 2),
          Text(
            label,
            style: LbText.number(context, size: 12, color: color),
          ),
        ],
      ),
    );
  }
}
