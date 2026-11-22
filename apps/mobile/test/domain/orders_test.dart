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

  test('orders_optionTotalPricesFullPremium_twoContractsAt175Is350', () {
    const ticket = LongOptionTicket(
      instrumentId: '10000000-0000-0000-0000-000000000001',
      symbol: 'AAPL',
      expiration: '2026-12-18',
      strikeCents: 15000,
      contractType: OptionContractType.put,
      side: OptionTicketSide.buyToOpen,
      contracts: 2,
      limitCents: 175,
    );
    const intent = OrderIntent(
      symbol: 'AAPL',
      side: OrderSide.buy,
      quantity: 2,
      orderType: OrderType.limit,
      limitPrice: 1.75,
      timeInForce: TimeInForce.day,
      invalidationPrice: 140,
      timeStopDate: '2026-12-02',
      thesis: 't',
      probabilityWin: 0.6,
      expectedGainPct: 10,
      expectedLossPct: 5,
      estimatedCostPct: 0.5,
      evidence: ['e'],
      longOption: ticket,
    );

    // Regression: quantity * limitPrice is $3.50; the premium is $350.
    expect(isOptionIntent(intent), isTrue);
    expect(isValidLongOptionTicket(ticket), isTrue);
    expect(isValidOptionIntent(intent), isTrue);
    expect(optionProblem(intent), isNull);
    expect(optionLimitPerShare(ticket), closeTo(1.75, 1e-9));
    expect(optionStrike(ticket), closeTo(150, 1e-9));
    expect(optionSideLabel(ticket), 'Buy to open');
    expect(optionTypeLabel(ticket), 'Put');
    expect(optionTotal(ticket), closeTo(350, 1e-9));
    expect(notional(intent), closeTo(350, 1e-9));
    expect(optionFilledTotal(2, 1.75), closeTo(350, 1e-9));
    expect(fractionalQuoteLabel(intent), isNull);
  });

  test('orders_mismatchedOrMalformedOptionStaysAnOptionAndBlocksApproval', () {
    const good = LongOptionTicket(
      instrumentId: '10000000-0000-0000-0000-000000000001',
      symbol: 'AAPL',
      expiration: '2026-12-18',
      strikeCents: 15000,
      contractType: OptionContractType.put,
      side: OptionTicketSide.buyToOpen,
      contracts: 2,
      limitCents: 175,
    );
    OrderRecord optionWith({double quantity = 2, LongOptionTicket? ticket}) {
      return OrderRecord(
        id: 'opt',
        createdAt: 1,
        updatedAt: 1,
        intent: OrderIntent(
          symbol: 'AAPL',
          side: OrderSide.buy,
          quantity: quantity,
          orderType: OrderType.limit,
          limitPrice: 1.75,
          timeInForce: TimeInForce.day,
          invalidationPrice: 140,
          timeStopDate: '2026-12-02',
          thesis: 't',
          probabilityWin: 0.6,
          expectedGainPct: 10,
          expectedLossPct: 5,
          estimatedCostPct: 0.5,
          evidence: const ['e'],
          longOption: ticket ?? good,
        ),
        verdict: const RiskVerdict(approved: true, isExit: false, checks: []),
        status: OrderStatus.pendingApproval,
      );
    }

    final mismatched = optionWith(quantity: 1);
    expect(isOptionIntent(mismatched.intent), isTrue);
    expect(isValidOptionIntent(mismatched.intent), isFalse);
    expect(optionProblem(mismatched.intent), contains('Contracts must equal'));

    const malformed = LongOptionTicket(
      instrumentId: 'not-a-uuid',
      symbol: 'AAPL',
      expiration: '2026-02-30',
      strikeCents: 0,
      contractType: OptionContractType.put,
      side: OptionTicketSide.buyToOpen,
      contracts: 2,
      limitCents: 175,
    );
    final bad = optionWith(ticket: malformed);
    expect(isOptionIntent(bad.intent), isTrue);
    expect(isValidOptionIntent(bad.intent), isFalse);
    expect(optionProblem(bad.intent), contains('incomplete or malformed'));
    expect(isValidLongOptionTicket(malformed), isFalse);
  });

  test('orders_optionTriggeringIsSubmissionUncertainNotAHeldStop', () {
    OrderRecord optionAt(OrderStatus status) => OrderRecord(
          id: 'opt',
          createdAt: 1,
          updatedAt: 1,
          intent: const OrderIntent(
            symbol: 'AAPL',
            side: OrderSide.buy,
            quantity: 1,
            orderType: OrderType.limit,
            limitPrice: 1.75,
            timeInForce: TimeInForce.day,
            invalidationPrice: 140,
            timeStopDate: '2026-12-02',
            thesis: 't',
            probabilityWin: 0.6,
            expectedGainPct: 10,
            expectedLossPct: 5,
            estimatedCostPct: 0.5,
            evidence: ['e'],
            longOption: LongOptionTicket(
              instrumentId: '10000000-0000-0000-0000-000000000001',
              symbol: 'AAPL',
              expiration: '2026-12-18',
              strikeCents: 15000,
              contractType: OptionContractType.put,
              side: OptionTicketSide.buyToOpen,
              contracts: 1,
              limitCents: 175,
            ),
          ),
          verdict: const RiskVerdict(approved: true, isExit: false, checks: []),
          status: status,
        );

    expect(orderStatusLabel(optionAt(OrderStatus.triggering)), 'Submission uncertain');
    expect(orderStatusLabel(optionAt(OrderStatus.held)), 'Held');
    expect(orderStatusLabel(_order('s', OrderStatus.triggering)), 'Stop firing');
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
