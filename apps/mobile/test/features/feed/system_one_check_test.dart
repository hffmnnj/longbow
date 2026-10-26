import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/feed/order_card.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';
import 'feed_test_utils.dart';

const _blockedDetail =
    'blocked: low support, chasing 0.62 (block mode)';
const _adviceDetail =
    'clear (advice only): supported 0.83, consistent 0.91, chasing 0.05';

Future<StoreHarness> _pumpCard(
  WidgetTester tester,
  OrderRecord cardOrder,
) async {
  final h = await startHarness(tester);
  await pumpScreen(
    tester,
    Scaffold(body: SingleChildScrollView(child: OrderCard(order: cardOrder, compact: true))),
    harness: h,
  );
  return h;
}

void main() {
  group('OrderCard System One line', () {
    testWidgets('blockedReview_showsOnceAndStaysOutOfTheSummary',
        (tester) async {
      final h = await _pumpCard(
        tester,
        order(
          'ord-sys',
          checks: const [
            passCheck,
            RiskCheck(rule: 'system_one', ok: false, detail: _blockedDetail),
          ],
        ),
      );

      // The generic summary counts only the generic check: no double count.
      expect(find.textContaining('1 passed', findRichText: true), findsOneWidget);
      expect(find.textContaining('1 failed', findRichText: true), findsNothing);
      // The review has its own line, exactly once, while collapsed.
      expect(find.textContaining('System One.', findRichText: true), findsOneWidget);
      expect(find.textContaining(_blockedDetail, findRichText: true), findsOneWidget);

      await tester.tap(find.textContaining('Risk checks'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      // Expanding lists the generic checks without duplicating the review.
      expect(find.textContaining('System One.', findRichText: true), findsOneWidget);
      expect(find.textContaining(_blockedDetail, findRichText: true), findsOneWidget);
      expect(find.textContaining('Max position.', findRichText: true), findsOneWidget);
      await shutDown(tester, h);
    });

    testWidgets('adviceReview_showsBoltLineBesidePassingChecks',
        (tester) async {
      final h = await _pumpCard(
        tester,
        order(
          'ord-sys-ok',
          checks: const [
            RiskCheck(rule: 'system_one', ok: true, detail: _adviceDetail),
          ],
        ),
      );

      expect(find.textContaining('0 passed', findRichText: true), findsOneWidget);
      expect(find.textContaining('failed', findRichText: true), findsNothing);
      expect(find.textContaining('System One.', findRichText: true), findsOneWidget);
      expect(find.textContaining(_adviceDetail, findRichText: true), findsOneWidget);
      await shutDown(tester, h);
    });
  });
}
