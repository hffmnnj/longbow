import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/feed/order_card.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'feed_test_utils.dart';

void main() {
  group('owner order card', () {
    testWidgets('pendingOwnerOrder_showsBadgeExactDetailsAndActions', (tester) async {
      final h = await startHarness(tester);
      final o = order(
        'ord-owner-1',
        quantity: 0.123456,
        ownerMessageId: 'm-7',
        ownerInstruction: 'Buy a small piece of NVDA',
      );
      expect(o.status, OrderStatus.pendingApproval);
      await pumpScreen(
        tester,
        Scaffold(body: SingleChildScrollView(child: OrderCard(order: o))),
        harness: h,
        size: const Size(360, 800),
      );
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Owner order'), findsOneWidget);
      expect(find.textContaining('0.123456 shares of NVDA'), findsOneWidget);
      expect(find.textContaining("Expires at today's close"), findsOneWidget);
      expect(find.textContaining('From your message:'), findsOneWidget);
      expect(find.textContaining('Buy a small piece of NVDA'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Reject'), findsOneWidget);
    });
  });
}
