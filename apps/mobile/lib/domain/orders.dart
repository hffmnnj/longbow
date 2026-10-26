// Dart port of `apps/web/src/lib/orders.ts`. Pure Dart: no Flutter imports.
import 'package:longbow/models/models.dart';

/// Notional value of an order intent: quantity times limit price.
double notional(OrderIntent i) => i.quantity * i.limitPrice;

/// Expected value in % of notional after estimated round-trip costs.
double expectedValuePct(OrderIntent i) {
  return i.probabilityWin * i.expectedGainPct -
      (1 - i.probabilityWin) * i.expectedLossPct -
      i.estimatedCostPct;
}

/// The risk checks that failed on an order record.
List<RiskCheck> failedChecks(OrderRecord o) =>
    o.verdict.checks.where((c) => !c.ok).toList();

/// Display label for every order status.
String statusLabel(OrderStatus status) => statusLabels[status]!;

/// Mirrors TS `STATUS_LABEL`: display label for every order status.
const Map<OrderStatus, String> statusLabels = {
  OrderStatus.pendingApproval: 'Awaiting approval',
  OrderStatus.rejectedRisk: 'Blocked by risk',
  OrderStatus.rejectedUser: 'Rejected',
  OrderStatus.expired: 'Expired',
  OrderStatus.submitted: 'Submitted',
  OrderStatus.held: 'Stop held',
  OrderStatus.triggering: 'Stop firing',
  OrderStatus.partiallyFilled: 'Partly filled',
  OrderStatus.filled: 'Filled',
  OrderStatus.cancelled: 'Cancelled',
  OrderStatus.failed: 'Failed',
};

/// Orders still working or waiting on something (a human, the broker, the
/// harness stop watcher).
const Set<OrderStatus> openOrderStatuses = {
  OrderStatus.pendingApproval,
  OrderStatus.submitted,
  OrderStatus.held,
  OrderStatus.triggering,
  OrderStatus.partiallyFilled,
};

/// Terminal states: the order will not move again without a brand-new order.
const Set<OrderStatus> doneOrderStatuses = {
  OrderStatus.rejectedRisk,
  OrderStatus.rejectedUser,
  OrderStatus.expired,
  OrderStatus.filled,
  OrderStatus.cancelled,
  OrderStatus.failed,
};

/// True while the order is still working or waiting.
bool isOpenOrderStatus(OrderStatus status) => openOrderStatuses.contains(status);

/// True once the order reached a terminal state.
bool isDoneOrderStatus(OrderStatus status) => doneOrderStatuses.contains(status);

/// "max_position" becomes "Max position".
String ruleName(String rule) {
  final s = rule.replaceAll('_', ' ');
  return s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}
