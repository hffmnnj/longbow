import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/domain/orders.dart';
import 'package:longbow/models/models.dart';

OrderRecord _order(String id, OrderStatus status, {List<RiskCheck>? checks}) {
  return OrderRecord(
    id: id,
    createdAt: 1,
    updatedAt: 1,
    intent: const OrderIntent(
      symbol: 'MSFT',
      side: OrderSide.buy,
      quantity: 3,
      orderType: OrderType.limit,
      limitPrice: 413.2,
      timeInForce: TimeInForce.day,
      invalidationPrice: 407.1,
      timeStopDate: '2026-10-30',
      thesis: 'Post-earnings drift holds above the 20 day average.',
      probabilityWin: 0.58,
      expectedGainPct: 4.2,
      expectedLossPct: 1.5,
      estimatedCostPct: 0.08,
      evidence: ['get_quote MSFT bid 413.15 ask 413.25'],
    ),
    verdict: RiskVerdict(
      approved: true,
      isExit: false,
      checks: checks ?? const [],
    ),
    status: status,
  );
}

void main() {
  test('orders_notionalMultipliesQuantityByLimitPrice', () {
    expect(notional(_order('o', OrderStatus.pendingApproval).intent), closeTo(1239.6, 1e-9));
  });

  test('orders_expectedValueSubtractsLossesAndCosts', () {
    // 0.58*4.2 - 0.42*1.5 - 0.08 = 1.726
    expect(
      expectedValuePct(_order('o', OrderStatus.pendingApproval).intent),
      closeTo(1.726, 1e-9),
    );
  });

  test('orders_failedChecksListsOnlyFailingRules', () {
    final order = _order(
      'o',
      OrderStatus.pendingApproval,
      checks: const [
        RiskCheck(rule: 'x', ok: false, detail: 'd'),
        RiskCheck(rule: 'y', ok: true, detail: 'ok'),
      ],
    );

    expect(failedChecks(order).map((c) => c.rule), ['x']);
    expect(
      failedChecks(_order('ok', OrderStatus.pendingApproval)),
      isEmpty,
    );
  });

  test('orders_ruleNameHumanizesSnakeCase', () {
    expect(ruleName('max_position'), 'Max position');
  });

  test('orders_statusLabelCoversEveryStatus', () {
    expect(statusLabels, {
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
    });
  });

  test('orders_openAndDonePartitionAllStatuses', () {
    const open = [
      OrderStatus.pendingApproval,
      OrderStatus.submitted,
      OrderStatus.held,
      OrderStatus.triggering,
      OrderStatus.partiallyFilled,
    ];
    const done = [
      OrderStatus.rejectedRisk,
      OrderStatus.rejectedUser,
      OrderStatus.expired,
      OrderStatus.filled,
      OrderStatus.cancelled,
      OrderStatus.failed,
    ];

    expect({...open, ...done}, statusLabels.keys.toSet());
    for (final s in open) {
      expect(isOpenOrderStatus(s), isTrue, reason: '$s');
      expect(isDoneOrderStatus(s), isFalse, reason: '$s');
    }
    for (final s in done) {
      expect(isOpenOrderStatus(s), isFalse, reason: '$s');
      expect(isDoneOrderStatus(s), isTrue, reason: '$s');
    }
  });
}
