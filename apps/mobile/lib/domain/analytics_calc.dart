import 'dart:math' as math;

import 'package:longbow/core/format.dart' show Tone, isoShort, pctSigned;
import 'package:longbow/models/models.dart';

/// Dart port of `apps/web/src/lib/analytics.ts`. Pure logic, no widgets:
/// where the web returns a CSS class or colour name, this returns data and
/// the [Tone] enum from `core/format.dart`.

/// Keep at most [max] items, always including the first and the last, spread
/// evenly between.
List<T> thinSeries<T>(List<T> items, int max) {
  if (max < 2 || items.length <= max) return List.of(items);
  final out = <T>[];
  final step = (items.length - 1) / (max - 1);
  var last = -1;
  for (var i = 0; i < max; i++) {
    final idx = (i * step).round();
    if (idx != last) out.add(items[idx]);
    last = idx;
  }
  return out;
}

/// Each value as a percent change from the first value.
List<double> indexToStart(List<double> values) {
  if (values.isEmpty || values[0] == 0) {
    return values.map((_) => 0.0).toList();
  }
  final base = values[0];
  return values.map((v) => ((v - base) / base) * 100).toList();
}

/// Result of [rebase]: the floor subtracted from every value, plus the
/// rebased rows (add [offset] back for axis labels).
class RebaseResult {
  const RebaseResult({required this.offset, required this.rows});
  final double offset;
  final List<List<double>> rows;
}

/// The dither engine draws from a floor of zero, which would flatten a line
/// that moves 2% around $25,000. Subtract a floor just under the lowest value
/// and add it back in labels.
RebaseResult rebase(List<List<double>> series, [double pad = 0.12]) {
  final all = series.expand((s) => s).where((v) => v.isFinite).toList();
  if (all.isEmpty) {
    return RebaseResult(
      offset: 0,
      rows: series.map((s) => s.map((_) => 0.0).toList()).toList(),
    );
  }
  final lo = all.reduce(math.min);
  final hi = all.reduce(math.max);
  var span = hi - lo;
  if (span == 0) span = hi.abs() * 0.02;
  if (span == 0) span = 1;
  // Round the floor down to a round number so axis ticks read as round
  // numbers once the floor is added back.
  final step = math.pow(10, (math.log(span) / math.ln10).floor()).toDouble();
  final offset = math.max(0.0, ((lo - span * pad) / step).floor() * step);
  return RebaseResult(
    offset: offset,
    rows: series.map((s) => s.map((v) => v - offset).toList()).toList(),
  );
}

class EquityRow {
  const EquityRow({required this.date, required this.equity, this.benchmark});
  final String date;
  final double equity;
  final double? benchmark;
}

class EquityRows {
  const EquityRows({required this.rows, required this.hasBenchmark});
  final List<EquityRow> rows;
  final bool hasBenchmark;
}

/// Equity marks thinned for drawing, with the benchmark only when every mark
/// carries one.
EquityRows equityRows(EquityHistory history, [int max = 120]) {
  final hasBenchmark =
      history.points.isNotEmpty &&
      history.points.every((p) => p.benchmark != null);
  final rows = thinSeries(history.points, max)
      .map(
        (p) => EquityRow(
          date: p.date,
          equity: p.equity,
          benchmark: hasBenchmark ? p.benchmark : null,
        ),
      )
      .toList();
  return EquityRows(rows: rows, hasBenchmark: hasBenchmark);
}

/// "Up 1.9% vs SPY's −0.6% since Oct 24".
String? equityReading(EquityHistory history) {
  if (history.points.isEmpty ||
      history.returnPct == null ||
      history.points.length < 2) {
    return null;
  }
  final ret = history.returnPct!;
  final dir = ret >= 0 ? 'Up' : 'Down';
  final mine = pctSigned(ret.abs() < 0.005 ? 0 : ret)
      .replaceFirst(RegExp('^[+\u2212]'), '');
  final since = 'since ${isoShort(history.points[0].date)}';
  if (history.benchmarkReturnPct == null) return '$dir $mine $since';
  return '$dir $mine vs SPY\'s ${pctSigned(history.benchmarkReturnPct!)} $since';
}

const String replayLabel = "Today's holdings, replayed";
const String replayNote =
    'What today\'s positions and cash would have been worth on each past day. Not the account\'s real history.';

List<HoldingsReplayPoint> replayRows(EquityHistory history, [int max = 120]) =>
    thinSeries(history.holdingsReplay, max);

/// "Today's holdings would be up 6.4% over the last 3 months".
String? replayReading(EquityHistory history) {
  final rows = history.holdingsReplay;
  if (rows.length < 2) return null;
  final first = rows[0];
  final last = rows[rows.length - 1];
  if (first.value == 0) return null;
  final change = ((last.value - first.value) / first.value) * 100;
  return "Replay: today's holdings are ${pctSigned(change)} since ${isoShort(first.date)}";
}

class CalibrationRow {
  const CalibrationRow({
    required this.key,
    required this.label,
    required this.predicted,
    required this.realized,
    required this.count,
  });
  final String key;
  final String label;
  final double predicted;
  final double realized;
  final int count;
}

/// Buckets with at least one trade, labelled "50–60%" with the trade count.
List<CalibrationRow> calibrationRows(List<CalibrationBucket> buckets) => buckets
    .where((b) => b.count > 0)
    .map(
      (b) => CalibrationRow(
        key: '${b.from}-${b.to}',
        label: '${(b.from * 100).round()}\u2013${(b.to * 100).round()}%',
        predicted: (b.predicted * 1000).round() / 10,
        realized: (b.realized * 1000).round() / 10,
        count: b.count,
      ),
    )
    .toList();

/// Plain reading of how honest the agent's probabilities are, weighted by
/// trades per bucket.
String? calibrationReading(List<CalibrationBucket> buckets) {
  final rows = buckets.where((b) => b.count > 0).toList();
  final n = rows.fold(0, (a, b) => a + b.count);
  if (n == 0) return null;
  final gap =
      rows.fold(0.0, (a, b) => a + (b.realized - b.predicted) * b.count) / n;
  final pts = (gap.abs() * 100).round();
  final sample = 'across $n trade${n == 1 ? '' : 's'}';
  if (pts < 2) return 'Predicted and realized win rates match $sample';
  return gap < 0
      ? 'Realized win rate runs $pts points below predictions $sample'
      : 'Realized win rate runs $pts points above predictions $sample';
}

class PnlBar {
  const PnlBar({
    required this.key,
    required this.label,
    required this.gain,
    required this.loss,
    required this.pnl,
    required this.trade,
  });
  final String key;
  final String label;
  final double gain;
  final double loss;
  final double pnl;
  final ClosedTrade trade;
}

/// Closed trades oldest first, with wins and losses split so each draws as
/// magnitude in its own colour.
List<PnlBar> pnlBars(List<ClosedTrade> trades, [int max = 40]) {
  final sorted = List.of(trades)
    ..sort((a, b) => a.closedAt.compareTo(b.closedAt));
  final tail = sorted.length <= max
      ? sorted
      : sorted.sublist(sorted.length - max);
  return tail
      .asMap()
      .entries
      .map(
        (e) => PnlBar(
          key: '${e.value.symbol}-${e.value.closedAt}-${e.key}',
          label: e.value.symbol,
          gain: e.value.pnl > 0 ? e.value.pnl : 0,
          loss: e.value.pnl < 0 ? -e.value.pnl : 0,
          pnl: e.value.pnl,
          trade: e.value,
        ),
      )
      .toList();
}

/// List keys for server rows whose natural key can repeat in real data (a feed
/// that emits an event twice, two fills in the same millisecond). The index is
/// the tiebreaker, so the key is unique by construction.
String calendarKey(CalendarEvent c, int i) => '${c.date} ${c.event} $i';

String earningsKey(EarningsEvent e, int i) => '${e.symbol} ${e.date} $i';

String closedTradeKey(ClosedTrade t, int i) => '${t.symbol} ${t.closedAt} $i';

String simFillKey(SimFill f, int i) => '${f.orderId} ${f.at} $i';

String riskCheckKey(RiskCheck c, int i) => '${c.rule} $i';

class CalendarDay<T> {
  const CalendarDay({required this.date, required this.items});
  final String date;
  final List<T> items;
}

/// Economic calendar grouped by date, keeping the server's first-seen order.
List<CalendarDay<T>> groupCalendarDays<T>(
  List<T> calendar,
  String Function(T) dateOf,
) {
  final groups = <String, List<T>>{};
  for (final c in calendar) {
    final list = groups[dateOf(c)];
    if (list != null) {
      list.add(c);
    } else {
      groups[dateOf(c)] = [c];
    }
  }
  return groups.entries
      .map((e) => CalendarDay(date: e.key, items: e.value))
      .toList();
}

String? pnlReading(List<ClosedTrade> trades) {
  if (trades.isEmpty) return null;
  final wins = trades.where((t) => t.pnl > 0).length;
  final net = trades.fold(0.0, (a, t) => a + t.pnl);
  return '$wins of ${trades.length} closed trades won; net ${net >= 0 ? 'gain' : 'loss'} across them';
}

const Map<TradeSource, String> sourceLabel = {
  TradeSource.harness: 'Longbow',
  TradeSource.robinhood: 'Robinhood history',
};

/// Heat cap implied by the risk settings: every position at its full
/// per-trade risk.
double heatCapPct(RiskConfig risk) =>
    risk.maxPositions * risk.maxRiskPerTradePct;

/// Percent the price sits above its stop; negative when already through it.
double distanceToStopPct(double price, double stop) =>
    price == 0 ? 0 : ((price - stop) / price) * 100;

class PositionStop {
  const PositionStop({
    required this.position,
    this.price,
    this.weightPct,
    this.stopPrice,
    this.distancePct,
    this.riskToStopPct,
  });
  final Position position;
  final double? price;
  final double? weightPct;
  final double? stopPrice;
  final double? distancePct;
  final double? riskToStopPct;
}

/// Joins held positions with the stop and weight the server computed.
List<PositionStop> positionStops(
  List<Position> positions,
  List<ExposureRow> exposure,
  double equity,
) {
  final bySymbol = {for (final e in exposure) e.symbol: e};
  final out = positions.map((position) {
    final e = bySymbol[position.symbol];
    final price = position.quantity > 0
        ? position.marketValue / position.quantity
        : null;
    final stopPrice = e?.stopPrice;
    return PositionStop(
      position: position,
      price: price,
      weightPct: e?.weightPct ??
          (equity > 0 ? (position.marketValue / equity) * 100 : null),
      stopPrice: stopPrice,
      distancePct: price != null && stopPrice != null
          ? distanceToStopPct(price, stopPrice)
          : null,
      riskToStopPct: e?.riskToStopPct,
    );
  }).toList()
    ..sort((a, b) => b.position.marketValue.compareTo(a.position.marketValue));
  return out;
}

const Map<OrderStatus, String> orderOutcomeLabel = {
  OrderStatus.filled: 'Filled',
  OrderStatus.partiallyFilled: 'Partly filled',
  OrderStatus.submitted: 'Working',
  OrderStatus.held: 'Stop held',
  OrderStatus.triggering: 'Stop firing',
  OrderStatus.pendingApproval: 'Awaiting approval',
  OrderStatus.rejectedRisk: 'Blocked by risk',
  OrderStatus.rejectedUser: 'Rejected by you',
  OrderStatus.expired: 'Expired',
  OrderStatus.cancelled: 'Cancelled',
  OrderStatus.failed: 'Failed',
};

class OrderOutcome {
  const OrderOutcome({
    required this.status,
    required this.label,
    required this.count,
  });
  final OrderStatus status;
  final String label;
  final int count;

  @override
  bool operator ==(Object other) =>
      other is OrderOutcome &&
      other.status == status &&
      other.label == label &&
      other.count == count;

  @override
  int get hashCode => Object.hash(status, label, count);
}

/// Order counts, largest first, zero rows dropped.
List<OrderOutcome> orderOutcomes(Map<OrderStatus, int> counts) {
  final out = counts.entries
      .where((e) => e.value > 0)
      .map(
        (e) => OrderOutcome(
          status: e.key,
          label: orderOutcomeLabel[e.key]!,
          count: e.value,
        ),
      )
      .toList()
    ..sort((a, b) => b.count.compareTo(a.count));
  return out;
}

/// 52-week range position, 0 at the low and 100 at the high.
double rangePosition(double price, double low, double high) {
  if (high <= low) return 50;
  return math.max(0, math.min(100, ((price - low) / (high - low)) * 100));
}

const List<List<int>> _bayer4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/// An SVG tile that fades from solid to sparse across [cols] columns of
/// [cell]-px squares, using the same 4x4 Bayer matrix as the chart engine.
/// Used as the dithered end of horizontal bars.
String ditherRampSvg([int cols = 10, int cell = 2, String color = '#000']) {
  final rects = <String>[];
  for (var x = 0; x < cols; x++) {
    final density = 1 - x / cols;
    for (var y = 0; y < 4; y++) {
      if ((_bayer4[y][x % 4] + 0.5) / 16 < density) {
        rects.add(
          '<rect x="${x * cell}" y="${y * cell}" width="$cell" height="$cell"/>',
        );
      }
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${4 * cell}" fill="$color">${rects.join('')}</svg>';
}

/// "10Y at 4.18%, 32 bp above 2Y: the curve slopes up".
String? yieldReading(List<YieldPoint> yields) {
  YieldPoint? find(String tenor) {
    for (final y in yields) {
      if (y.tenor == tenor) return y;
    }
    return null;
  }

  final y2 = find('2Y');
  final y10 = find('10Y');
  if (y2 == null || y10 == null) return null;
  final bp = ((y10.yieldPct - y2.yieldPct) * 100).round();
  final shape = bp > 5
      ? 'the curve slopes up'
      : bp < -5
          ? 'the curve is inverted'
          : 'the curve is flat';
  return '10Y at ${y10.yieldPct.toStringAsFixed(2)}%, ${bp.abs()} bp ${bp >= 0 ? 'above' : 'below'} 2Y: $shape';
}

/// JS-style `%` (truncated remainder) so ordinals match the web exactly.
int _jsRem(int a, int b) => a - (a / b).truncate() * b;

String _ordinal(num n) {
  final v = n.round();
  const s = ['th', 'st', 'nd', 'rd'];
  final r = _jsRem(v, 100);
  final idx = _jsRem(r - 20, 10);
  String? pick(int i) => (i >= 0 && i < s.length) ? s[i] : null;
  return '$v${pick(idx) ?? pick(r) ?? s[0]}';
}

String vixReading(VolatilityInfo vol) {
  final rank = vol.percentile != null
      ? ' at the ${_ordinal(vol.percentile!)} percentile of the past year'
      : '';
  return 'VIX ${vol.vix.toStringAsFixed(1)}$rank; ${vol.contango ? 'near-term fear is below the 3-month level (contango)' : 'near-term fear is above the 3-month level (backwardation)'}';
}

double breadthPct(BreadthInfo b) =>
    b.total > 0 ? (b.aboveSma50 / b.total) * 100 : 0;
