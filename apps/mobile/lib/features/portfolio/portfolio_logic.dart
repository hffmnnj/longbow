// Pure presentation logic for the Portfolio tab (no widgets).
import 'package:longbow/core/charts/charts.dart' show ChartTone;
import 'package:longbow/core/format.dart';
import 'package:longbow/domain/analytics_calc.dart';
import 'package:longbow/domain/orders.dart';
import 'package:longbow/models/models.dart';

String _lead(double v) => v.abs() >= 1 ? v.abs().toStringAsFixed(1) : v.abs().toStringAsFixed(2);

/// "Up 3.2% since Oct 1, 1.1 points ahead of SPY". Null until there are two
/// marks and a return to describe.
String? equityVsSpyReading(EquityHistory h) {
  final ret = h.returnPct;
  if (h.points.length < 2 || ret == null) return null;
  final since = isoShort(h.points.first.date);
  final lead = ret.abs() < 0.005
      ? 'Flat since $since'
      : '${ret > 0 ? 'Up' : 'Down'} ${_lead(ret)}% since $since';
  final bench = h.benchmarkReturnPct;
  if (bench == null) return lead;
  final gap = ret - bench;
  if (gap.abs() < 0.05) return '$lead, level with SPY';
  return '$lead, ${_lead(gap)} points ${gap > 0 ? 'ahead of' : 'behind'} SPY';
}

/// Open orders, newest first.
List<OrderRecord> openOrders(List<OrderRecord> orders) =>
    orders.where((o) => isOpenOrderStatus(o.status)).toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

/// Bar colour for the distance to the stop: close is loss, near is warn.
ChartTone stopTone(double distancePct) =>
    distancePct < 3 ? ChartTone.loss : (distancePct < 6 ? ChartTone.warn : ChartTone.muted);

class AllocSlice {
  const AllocSlice(this.label, this.weightPct, {this.isCash = false, this.isOther = false});
  final String label;
  final double weightPct;
  final bool isCash;
  final bool isOther;
}

/// Largest [names] positions, the rest folded into "Other", then cash. Weights
/// are percent of equity; empty when equity is not positive.
List<AllocSlice> allocationSlices(List<PositionStop> rows, double equity, double cash, {int names = 4}) {
  if (equity <= 0) return const [];
  double w(double v) => v / equity * 100;
  final out = <AllocSlice>[
    for (final r in rows.take(names)) AllocSlice(r.position.symbol, w(r.position.marketValue)),
  ];
  final rest = rows.skip(names).fold<double>(0, (a, r) => a + r.position.marketValue);
  if (rest > 0) out.add(AllocSlice('Other', w(rest), isOther: true));
  if (cash > 0) out.add(AllocSlice('Cash', w(cash), isCash: true));
  return out;
}

/// Unrealized return on cost, in percent; null when cost is not positive.
double? returnOnCost(Position p) {
  final cost = p.marketValue - p.unrealizedPnl;
  return cost > 0 ? p.unrealizedPnl / cost * 100 : null;
}
