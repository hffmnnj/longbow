import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/feed/order_card.dart';
import 'package:longbow/features/feed/order_sheet.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'feed_test_utils.dart';

const _ticket = LongOptionTicket(
  instrumentId: '10000000-0000-0000-0000-000000000001',
  symbol: 'AAPL',
  expiration: '2026-12-18',
  strikeCents: 15000,
  contractType: OptionContractType.put,
  side: OptionTicketSide.buyToOpen,
  contracts: 2,
  limitCents: 175,
);

OrderRecord _mismatchedOption(String id) {
  // Ticket says 2 contracts but the order quantity says 1: the ticket and
  // the order disagree, so approval must stay blocked and no stock ticket
  // may appear.
  return OrderRecord(
    id: id,
    createdAt: 1000,
    updatedAt: 1000,
    intent: const OrderIntent(
      symbol: 'AAPL',
      side: OrderSide.buy,
      quantity: 1,
      orderType: OrderType.limit,
      limitPrice: 1.75,
      timeInForce: TimeInForce.day,
      invalidationPrice: 140,
      timeStopDate: '2026-12-02',
      thesis: 'Pullback with defined risk.',
      probabilityWin: 0.6,
      expectedGainPct: 10,
      expectedLossPct: 5,
      estimatedCostPct: 0.5,
      evidence: ['e'],
      longOption: _ticket,
    ),
    verdict: const RiskVerdict(approved: true, isExit: false, checks: []),
    status: OrderStatus.pendingApproval,
  );
}

void main() {
  group('option order card', () {
    testWidgets('validOption_showsFullPremiumNotPerShareMath', (tester) async {
      final h = await startHarness(tester);
      final o = order('ord-opt-1', longOption: _ticket);
      await pumpScreen(
        tester,
        Scaffold(body: SingleChildScrollView(child: OrderCard(order: o))),
        harness: h,
        size: const Size(360, 900),
      );
      await tester.pump(const Duration(milliseconds: 400));

      // Distinct option badge, contract terms, per-share limit and full premium.
      expect(find.text('Option'), findsWidgets);
      expect(find.textContaining('Buy to open'), findsWidgets);
      expect(find.textContaining('2 contracts'), findsWidgets);
      expect(find.textContaining('\$150'), findsWidgets);
      expect(find.textContaining('Exp Dec 18', findRichText: true), findsWidgets);
      expect(find.textContaining('\$1.75 per share', findRichText: true), findsWidgets);
      // 2 contracts at $1.75 is $350, never quantity * limitPrice ($3.50).
      expect(find.text('\$350.00'), findsWidgets);
      expect(find.text('\$3.50'), findsNothing);
      expect(
        find.textContaining('If exercised, this can create AAPL stock', findRichText: true),
        findsOneWidget,
      );
      expect(find.textContaining('A fill is not guaranteed', findRichText: true), findsOneWidget);
      // Stock-only chrome stays off the ticket.
      expect(find.textContaining('3 @', findRichText: true), findsNothing);
      expect(find.textContaining('Invalidation', findRichText: true), findsNothing);

      final approve =
          tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Approve'));
      expect(approve.onPressed, isNotNull, reason: 'valid option approval stays actionable');
      expect(find.widgetWithText(OutlinedButton, 'Reject'), findsOneWidget);
    });

    testWidgets('mismatchedOption_blocksApprovalWithoutStockTicket', (tester) async {
      final h = await startHarness(tester);
      final o = _mismatchedOption('ord-opt-bad');
      await pumpScreen(
        tester,
        Scaffold(body: SingleChildScrollView(child: OrderCard(order: o))),
        harness: h,
        size: const Size(360, 900),
      );
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Option details need review.'), findsWidgets);
      expect(find.textContaining('Contracts must equal', findRichText: true), findsWidgets);
      expect(find.textContaining('Do not approve', findRichText: true), findsWidgets);
      // No share quantity, price, or notional leaks onto a malformed ticket.
      expect(find.textContaining('1 @', findRichText: true), findsNothing);
      expect(find.text('\$350.00'), findsNothing);

      final approve =
          tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Approve'));
      expect(approve.onPressed, isNull, reason: 'malformed option approval is blocked');
      expect(find.widgetWithText(OutlinedButton, 'Reject'), findsOneWidget);
    });

    testWidgets('triggeringOptionSheet_saysSubmissionUncertain', (tester) async {
      final h = await startHarness(tester, script: (api) {
        api.on('orders', () async => [order('ord-opt-2', status: OrderStatus.triggering, longOption: _ticket)]);
      });
      await pumpScreen(
        tester,
        Scaffold(
          body: Builder(
            builder: (context) => Center(
              child: TextButton(
                onPressed: () => showOrderSheet(context, 'ord-opt-2'),
                child: const Text('open'),
              ),
            ),
          ),
        ),
        harness: h,
        size: const Size(360, 800),
      );
      await tester.tap(find.text('open'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.text('Submission uncertain'), findsOneWidget);
      expect(find.text('Stop firing'), findsNothing);
      expect(find.text('Total at limit'), findsOneWidget);
      expect(find.textContaining('\$350.00 debit'), findsWidgets);
      expect(find.textContaining('If exercised, this can create AAPL stock'), findsWidgets);
    });
  });
}
