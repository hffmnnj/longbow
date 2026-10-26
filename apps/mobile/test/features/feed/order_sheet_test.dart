import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/feed/decision_card.dart';
import 'package:longbow/features/feed/order_sheet.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'feed_test_utils.dart';

Future<void> _openSheet(WidgetTester tester, StoreHarness h, String orderId) async {
  await pumpScreen(
    tester,
    Scaffold(
      body: Builder(
        builder: (context) => Center(child: TextButton(onPressed: () => showOrderSheet(context, orderId), child: const Text('open'))),
      ),
    ),
    harness: h,
    size: const Size(360, 800),
  );
  await tester.tap(find.text('open'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  group('order sheet', () {
    testWidgets('settledOrder_showsPlanFillThesisEvidenceAndEveryRiskCheck', (tester) async {
      final h = await startHarness(tester, script: (api) {
        api.on('orders', () async => [
              order(
                'ord-9',
                status: OrderStatus.rejectedRisk,
                checks: const [passCheck, failCheck],
                review: 'Blocked: spread too wide.',
                error: 'Spread 42 bps exceeds the limit.',
                filled: 2,
                fillPrice: 502.5,
              ),
            ]);
      });
      await _openSheet(tester, h, 'ord-9');

      expect(find.text('Order'), findsOneWidget);
      expect(find.text('Blocked by risk'), findsOneWidget);
      expect(find.text('3 @ \$501.25'), findsOneWidget, reason: 'size shows quantity and limit');
      expect(find.text('\$1,503.75'), findsOneWidget, reason: 'notional is 3 x 501.25');
      expect(find.text('2 @ \$502.50'), findsOneWidget, reason: 'fill details');
      expect(find.text('2026-11-06'), findsOneWidget);
      expect(find.text('Pullback to the 50-day with falling volume.'), findsOneWidget);
      expect(find.text('Spread 42 bps exceeds the limit.'), findsOneWidget);
      expect(find.text('Blocked: spread too wide.'), findsOneWidget);
      expect(find.text('RSI(2) at 8'), findsOneWidget);
      expect(find.text('Held the 50-day average'), findsOneWidget);
      expect(find.textContaining('Max position.', findRichText: true), findsOneWidget, reason: 'passing check listed too');
      expect(find.textContaining('Max spread.', findRichText: true), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsNothing, reason: 'settled orders have no actions');
    });

    testWidgets('pendingOrder_showsApproveAndRejectInTheSheet', (tester) async {
      final h = await startHarness(tester, script: (api) => api.on('orders', () async => [order('ord-1')]));
      await _openSheet(tester, h, 'ord-1');

      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Reject'), findsOneWidget);
      expect(find.text('Awaiting approval'), findsOneWidget);
    });

    testWidgets('unknownOrder_saysItIsNotInTheRecentList', (tester) async {
      final h = await startHarness(tester);
      await _openSheet(tester, h, 'ord-gone');

      expect(find.text('Order not found'), findsOneWidget);
      expect(find.text('This order is no longer in the recent list.'), findsOneWidget);
    });
  });

  group('DecisionCard', () {
    testWidgets('withOrder_showsRiskSummaryAndOpensTheOrderSheet', (tester) async {
      final h = await startHarness(tester, script: (api) {
        api.on('orders', () async => [order('ord-1', status: OrderStatus.rejectedRisk, checks: const [passCheck, failCheck])]);
      });
      await pumpScreen(
        tester,
        Scaffold(body: SingleChildScrollView(child: DecisionCard(entry: decision('j1', orderId: 'ord-1')))),
        harness: h,
      );

      expect(find.text('Buy NVDA on the pullback'), findsOneWidget);
      expect(find.text('Risk: 1 of 2 failed'), findsOneWidget);
      expect(find.text('win 62%'), findsOneWidget);
      expect(find.text('Evidence 2'), findsNothing);
      expect(find.text('EVIDENCE 2'), findsOneWidget);
      expect(find.text('Held the 50-day average'), findsNothing, reason: 'only the first evidence line while collapsed');

      await tester.tap(find.text('Details'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Held the 50-day average'), findsOneWidget);
      expect(find.textContaining('Max spread.', findRichText: true), findsOneWidget);

      await tester.tap(find.text('Blocked by risk'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('Order'), findsOneWidget);
      expect(find.text('Blocked by risk'), findsWidgets);
    });

    testWidgets('orderMissing_saysSo_andNoOrderBuySaysNoOrderSubmitted', (tester) async {
      final h = await startHarness(tester);
      await pumpScreen(
        tester,
        Scaffold(
          body: SingleChildScrollView(
            child: Column(children: [
              DecisionCard(entry: decision('j1', orderId: 'ord-gone')),
              DecisionCard(entry: decision('j2')),
            ]),
          ),
        ),
        harness: h,
        size: const Size(360, 900),
      );

      expect(find.text('Order no longer in the recent list'), findsOneWidget);
      expect(find.text('No order was submitted'), findsOneWidget);
    });
  });
}
