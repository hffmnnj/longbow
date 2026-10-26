import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('orders_parsesPendingApprovalOrder', () {
    final list =
        jsonDecode(File('test/fixtures/orders.json').readAsStringSync())
            as List;
    final order = OrderRecord.fromJson(list.single as Map<String, dynamic>);

    expect(order.id, 'ord-handbuilt-001');
    expect(order.status, OrderStatus.pendingApproval);
    expect(order.intent.symbol, 'SPY');
    expect(order.intent.side, OrderSide.buy);
    expect(order.intent.orderType, OrderType.limit);
    expect(order.intent.timeInForce, TimeInForce.day);
    expect(order.intent.limitPrice, closeTo(759.4, 1e-9));
    expect(order.intent.evidence, hasLength(2));
    expect(order.verdict.approved, isTrue);
    expect(order.verdict.isExit, isFalse);
    expect(order.verdict.maxQuantity, closeTo(0.7, 1e-9));
  });

  test('orders_copyWithReplacesStatus', () {
    final list =
        jsonDecode(File('test/fixtures/orders.json').readAsStringSync())
            as List;
    final order = OrderRecord.fromJson(list.single as Map<String, dynamic>);

    final rejected = order.copyWith(status: OrderStatus.rejectedUser);

    expect(rejected.status, OrderStatus.rejectedUser);
    expect(rejected.id, order.id);
    expect(rejected.intent.limitPrice, order.intent.limitPrice);
  });
}
