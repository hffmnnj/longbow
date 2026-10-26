// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'orders.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OrderIntent _$OrderIntentFromJson(Map<String, dynamic> json) => OrderIntent(
  symbol: json['symbol'] as String,
  side: $enumDecode(
    _$OrderSideEnumMap,
    json['side'],
    unknownValue: OrderSide.buy,
  ),
  quantity: (json['quantity'] as num).toDouble(),
  orderType: $enumDecode(
    _$OrderTypeEnumMap,
    json['orderType'],
    unknownValue: OrderType.limit,
  ),
  limitPrice: (json['limitPrice'] as num).toDouble(),
  stopPrice: (json['stopPrice'] as num?)?.toDouble(),
  timeInForce: $enumDecode(
    _$TimeInForceEnumMap,
    json['timeInForce'],
    unknownValue: TimeInForce.day,
  ),
  invalidationPrice: (json['invalidationPrice'] as num).toDouble(),
  timeStopDate: json['timeStopDate'] as String,
  thesis: json['thesis'] as String,
  probabilityWin: (json['probabilityWin'] as num).toDouble(),
  expectedGainPct: (json['expectedGainPct'] as num).toDouble(),
  expectedLossPct: (json['expectedLossPct'] as num).toDouble(),
  estimatedCostPct: (json['estimatedCostPct'] as num).toDouble(),
  sector: json['sector'] as String?,
  evidence: (json['evidence'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
);

const _$OrderSideEnumMap = {OrderSide.buy: 'buy', OrderSide.sell: 'sell'};

const _$OrderTypeEnumMap = {
  OrderType.limit: 'limit',
  OrderType.stopLimit: 'stop_limit',
};

const _$TimeInForceEnumMap = {TimeInForce.day: 'day', TimeInForce.gtc: 'gtc'};

RiskCheck _$RiskCheckFromJson(Map<String, dynamic> json) => RiskCheck(
  rule: json['rule'] as String,
  ok: json['ok'] as bool,
  detail: json['detail'] as String,
);

RiskVerdict _$RiskVerdictFromJson(Map<String, dynamic> json) => RiskVerdict(
  approved: json['approved'] as bool,
  isExit: json['isExit'] as bool,
  checks: (json['checks'] as List<dynamic>)
      .map((e) => RiskCheck.fromJson(e as Map<String, dynamic>))
      .toList(),
  maxQuantity: (json['maxQuantity'] as num?)?.toDouble(),
  quote: json['quote'] == null
      ? null
      : Quote.fromJson(json['quote'] as Map<String, dynamic>),
);

OrderRecord _$OrderRecordFromJson(Map<String, dynamic> json) => OrderRecord(
  id: json['id'] as String,
  createdAt: (json['createdAt'] as num).toInt(),
  updatedAt: (json['updatedAt'] as num).toInt(),
  cycleId: json['cycleId'] as String?,
  intent: OrderIntent.fromJson(json['intent'] as Map<String, dynamic>),
  verdict: RiskVerdict.fromJson(json['verdict'] as Map<String, dynamic>),
  status: $enumDecode(
    _$OrderStatusEnumMap,
    json['status'],
    unknownValue: OrderStatus.pendingApproval,
  ),
  review: json['review'] as String?,
  brokerOrderId: json['brokerOrderId'] as String?,
  filledQuantity: (json['filledQuantity'] as num?)?.toDouble(),
  averageFillPrice: (json['averageFillPrice'] as num?)?.toDouble(),
  error: json['error'] as String?,
);

const _$OrderStatusEnumMap = {
  OrderStatus.pendingApproval: 'pending_approval',
  OrderStatus.rejectedRisk: 'rejected_risk',
  OrderStatus.rejectedUser: 'rejected_user',
  OrderStatus.expired: 'expired',
  OrderStatus.submitted: 'submitted',
  OrderStatus.held: 'held',
  OrderStatus.triggering: 'triggering',
  OrderStatus.partiallyFilled: 'partially_filled',
  OrderStatus.filled: 'filled',
  OrderStatus.cancelled: 'cancelled',
  OrderStatus.failed: 'failed',
};
