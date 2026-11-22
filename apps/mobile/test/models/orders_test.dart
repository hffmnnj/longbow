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

  test('orders_parsesOwnerFieldsWhenPresentAndAbsent', () {
    final list =
        jsonDecode(File('test/fixtures/orders.json').readAsStringSync())
            as List;
    final base = list.single as Map<String, dynamic>;

    final plain = OrderRecord.fromJson(base);
    expect(plain.ownerMessageId, isNull);
    expect(plain.intent.ownerInstruction, isNull);
    expect(plain.intent.longOption, isNull);

    final owned = OrderRecord.fromJson({
      ...base,
      'ownerMessageId': 'm-7',
      'intent': {
        ...base['intent'] as Map<String, dynamic>,
        'ownerInstruction': 'Buy a small piece of SPY',
      },
    });
    expect(owned.ownerMessageId, 'm-7');
    expect(owned.intent.ownerInstruction, 'Buy a small piece of SPY');
    expect(owned.intent.symbol, plain.intent.symbol);
  });

  test('orders_optionalLongOptionParsesAndMalformedNeverThrowsOrBecomesStock', () {
    final list =
        jsonDecode(File('test/fixtures/orders.json').readAsStringSync())
            as List;
    final base = list.single as Map<String, dynamic>;
    final baseIntent = base['intent'] as Map<String, dynamic>;

    // Existing records without longOption still parse with a null ticket.
    expect(
      OrderRecord.fromJson(base).intent.longOption,
      isNull,
    );

    final ticket = {
      'instrumentId': '10000000-0000-0000-0000-000000000001',
      'symbol': 'AAPL',
      'expiration': '2026-12-18',
      'strikeCents': 15000,
      'contractType': 'put',
      'side': 'buy-to-open',
      'contracts': 2,
      'limitCents': 175,
    };
    final option = OrderRecord.fromJson({
      ...base,
      'intent': {
        ...baseIntent,
        'symbol': 'AAPL',
        'side': 'buy',
        'quantity': 2,
        'limitPrice': 1.75,
        'orderType': 'limit',
        'timeInForce': 'day',
        'longOption': ticket,
      },
    });
    expect(option.intent.longOption, isNotNull);
    expect(option.intent.longOption!.contracts, 2);
    expect(option.intent.longOption!.limitCents, 175);

    // Unknown contract types and wrong value types stay present as an
    // invalid ticket instead of throwing the order away or reading as stock.
    final unknownType = OrderRecord.fromJson({
      ...base,
      'intent': {...baseIntent, 'longOption': {...ticket, 'contractType': 'stock'}},
    });
    expect(unknownType.intent.longOption, isNotNull);

    final wrongTypes = OrderRecord.fromJson({
      ...base,
      'intent': {...baseIntent, 'longOption': {...ticket, 'limitCents': '175'}},
    });
    expect(wrongTypes.intent.longOption, isNotNull);
  });
}
