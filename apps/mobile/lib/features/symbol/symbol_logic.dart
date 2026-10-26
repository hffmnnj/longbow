// Pure presentation logic for the Symbol page (no widgets).
import 'package:longbow/core/charts/charts.dart' show ChartMarker, ChartMarkerKind;
import 'package:longbow/core/format.dart';
import 'package:longbow/domain/orders.dart';
import 'package:longbow/models/models.dart';

const Map<HistoryRange, String> historyRangeLabels = {
  HistoryRange.oneMonth: '1M',
  HistoryRange.threeMonths: '3M',
  HistoryRange.sixMonths: '6M',
  HistoryRange.oneYear: '1Y',
  HistoryRange.twoYears: '2Y',
  HistoryRange.fiveYears: '5Y',
};

String stopSourceLabel(StopSource s) => switch (s) {
      StopSource.held => 'held stop',
      StopSource.robinhood => 'Robinhood stop order',
      StopSource.thesis => 'thesis invalidation',
    };

/// Percent change from the first to the last close.
double? periodReturn(List<Bar> bars) {
  if (bars.isEmpty || bars.first.close == 0) return null;
  return (bars.last.close - bars.first.close) / bars.first.close * 100;
}

/// Change of [price] against the close before the last bar. Null with fewer
/// than two bars.
({double amount, double pct})? sessionChange(List<Bar> bars, double price) {
  if (bars.length < 2) return null;
  final prev = bars[bars.length - 2].close;
  if (prev == 0) return null;
  return (amount: price - prev, pct: (price - prev) / prev * 100);
}

/// One indicator tile: label, value, optional sub-line and tone.
class IndicatorCell {
  const IndicatorCell(this.label, this.value, {this.sub, this.tone = Tone.flat});
  final String label;
  final String value;
  final String? sub;
  final Tone tone;
}

IndicatorCell _average(String label, double? avg, double? price) {
  if (avg == null) return IndicatorCell(label, '\u2014');
  if (price == null) return IndicatorCell(label, usd(avg));
  final above = price >= avg;
  final gap = avg == 0 ? 0.0 : ((price - avg) / avg * 100).abs();
  return IndicatorCell(
    label,
    usd(avg),
    sub: 'price ${above ? 'above' : 'below'} by ${pct(gap)}',
    tone: above ? Tone.gain : Tone.loss,
  );
}

IndicatorCell _returnCell(String label, double? v) =>
    v == null ? IndicatorCell(label, '\u2014') : IndicatorCell(label, pctSigned(v), tone: tone(v));

List<IndicatorCell> indicatorCells(SymbolIndicators ind, double? price) {
  final rsi = ind.rsi14;
  final atr = ind.atr14;
  return [
    _average('20-day average', ind.sma20, price),
    _average('50-day average', ind.sma50, price),
    _average('200-day average', ind.sma200, price),
    IndicatorCell(
      'RSI 14',
      rsi == null ? '\u2014' : rsi.toStringAsFixed(0),
      sub: rsi == null ? null : (rsi >= 70 ? 'overbought' : (rsi <= 30 ? 'oversold' : 'neutral')),
    ),
    IndicatorCell(
      'ATR 14',
      atr == null ? '\u2014' : usd(atr),
      sub: atr != null && price != null && price > 0 ? '${pct(atr / price * 100)} of price' : null,
    ),
    _returnCell('1M return', ind.return1m),
    _returnCell('3M return', ind.return3m),
    IndicatorCell(
      'Avg \$ volume',
      ind.avgDollarVolume == null ? '\u2014' : usdCompact(ind.avgDollarVolume!),
      sub: '20 sessions',
    ),
  ];
}

/// Buy and sell markers for executed orders, placed on the last bar dated on
/// or before the fill day. Fills before the first bar are skipped.
List<ChartMarker> fillMarkers(List<Bar> bars, List<OrderRecord> orders, {LbZone? zone}) {
  if (bars.isEmpty) return const [];
  final out = <ChartMarker>[];
  for (final o in orders) {
    final filled = o.status == OrderStatus.filled || o.status == OrderStatus.partiallyFilled;
    if (!filled) continue;
    final day = etDayKey(o.updatedAt, zone: zone);
    var idx = -1;
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].date.compareTo(day) <= 0) idx = i;
    }
    if (idx < 0) continue;
    final side = o.intent.side;
    final q = o.filledQuantity ?? o.intent.quantity;
    final price = o.averageFillPrice ?? o.intent.limitPrice;
    out.add(ChartMarker(
      index: idx,
      kind: side == OrderSide.buy ? ChartMarkerKind.buy : ChartMarkerKind.sell,
      label: '${side == OrderSide.buy ? 'Bought' : 'Sold'} ${qty(q)} at ${usd(price)}',
    ));
  }
  return out;
}

String orderLine(OrderRecord o) =>
    '${qty(o.intent.quantity)} @ ${usd(o.intent.limitPrice)} \u00b7 ${usd(notional(o.intent))}';
