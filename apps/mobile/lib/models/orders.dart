import 'package:json_annotation/json_annotation.dart';

import 'market.dart';

part 'orders.g.dart';

// Unknown sides read as buy; response-only, the app never submits from this.
enum OrderSide {
  @JsonValue('buy')
  buy,
  @JsonValue('sell')
  sell,
}

// Unknown order types read as limit, the only type the app can price.
enum OrderType {
  @JsonValue('limit')
  limit,
  @JsonValue('stop_limit')
  stopLimit,
}

// Unknown time-in-force reads as day so orders never rest open-ended.
enum TimeInForce {
  @JsonValue('day')
  day,
  @JsonValue('gtc')
  gtc,
}

// Unknown statuses wait for a human: pending approval never auto-acts.
enum OrderStatus {
  @JsonValue('pending_approval')
  pendingApproval,
  @JsonValue('rejected_risk')
  rejectedRisk,
  @JsonValue('rejected_user')
  rejectedUser,
  @JsonValue('expired')
  expired,
  @JsonValue('submitted')
  submitted,
  @JsonValue('held')
  held,
  @JsonValue('triggering')
  triggering,
  @JsonValue('partially_filled')
  partiallyFilled,
  @JsonValue('filled')
  filled,
  @JsonValue('cancelled')
  cancelled,
  @JsonValue('failed')
  failed,
}

@JsonSerializable(createToJson: false)
class OrderIntent {
  const OrderIntent({
    required this.symbol,
    required this.side,
    required this.quantity,
    required this.orderType,
    required this.limitPrice,
    this.stopPrice,
    required this.timeInForce,
    required this.invalidationPrice,
    required this.timeStopDate,
    required this.thesis,
    required this.probabilityWin,
    required this.expectedGainPct,
    required this.expectedLossPct,
    required this.estimatedCostPct,
    this.sector,
    required this.evidence,
  });

  factory OrderIntent.fromJson(Map<String, dynamic> json) =>
      _$OrderIntentFromJson(json);

  final String symbol;
  @JsonKey(unknownEnumValue: OrderSide.buy)
  final OrderSide side;
  final double quantity;
  @JsonKey(unknownEnumValue: OrderType.limit)
  final OrderType orderType;
  final double limitPrice;

  /// Trigger price, required for stop_limit.
  final double? stopPrice;
  @JsonKey(unknownEnumValue: TimeInForce.day)
  final TimeInForce timeInForce;

  /// Price at which the thesis is wrong; risk per share = |limitPrice - invalidationPrice|.
  final double invalidationPrice;

  /// ET date by which the thesis must have worked, YYYY-MM-DD.
  final String timeStopDate;
  final String thesis;

  /// Probability the trade reaches its target before invalidation, 0..1.
  final double probabilityWin;

  /// Expected % gain to target and % loss to invalidation, both positive numbers.
  final double expectedGainPct;
  final double expectedLossPct;

  /// Estimated round-trip costs (spread, slippage, fees) in % of notional.
  final double estimatedCostPct;
  final String? sector;

  /// Citations to tool outputs: tool name plus what it showed and when.
  final List<String> evidence;
}

@JsonSerializable(createToJson: false)
class RiskCheck {
  const RiskCheck({
    required this.rule,
    required this.ok,
    required this.detail,
  });

  factory RiskCheck.fromJson(Map<String, dynamic> json) =>
      _$RiskCheckFromJson(json);

  final String rule;
  final bool ok;
  final String detail;
}

@JsonSerializable(createToJson: false)
class RiskVerdict {
  const RiskVerdict({
    required this.approved,
    required this.isExit,
    required this.checks,
    this.maxQuantity,
    this.quote,
  });

  factory RiskVerdict.fromJson(Map<String, dynamic> json) =>
      _$RiskVerdictFromJson(json);

  final bool approved;

  /// True when the order reduces or closes an existing long.
  final bool isExit;
  final List<RiskCheck> checks;

  /// Largest quantity the sizing rules would allow, when computable.
  final double? maxQuantity;
  final Quote? quote;
}

@JsonSerializable(createToJson: false)
class OrderRecord {
  const OrderRecord({
    required this.id,
    required this.createdAt,
    required this.updatedAt,
    this.cycleId,
    required this.intent,
    required this.verdict,
    required this.status,
    this.review,
    this.brokerOrderId,
    this.filledQuantity,
    this.averageFillPrice,
    this.error,
  });

  factory OrderRecord.fromJson(Map<String, dynamic> json) =>
      _$OrderRecordFromJson(json);

  final String id;
  final int createdAt;
  final int updatedAt;
  final String? cycleId;
  final OrderIntent intent;
  final RiskVerdict verdict;
  @JsonKey(unknownEnumValue: OrderStatus.pendingApproval)
  final OrderStatus status;

  /// Text of Robinhood's review (pre-trade warnings), when run.
  final String? review;
  final String? brokerOrderId;
  final double? filledQuantity;
  final double? averageFillPrice;
  final String? error;

  OrderRecord copyWith({
    String? id,
    int? createdAt,
    int? updatedAt,
    String? cycleId,
    OrderIntent? intent,
    RiskVerdict? verdict,
    OrderStatus? status,
    String? review,
    String? brokerOrderId,
    double? filledQuantity,
    double? averageFillPrice,
    String? error,
  }) {
    return OrderRecord(
      id: id ?? this.id,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      cycleId: cycleId ?? this.cycleId,
      intent: intent ?? this.intent,
      verdict: verdict ?? this.verdict,
      status: status ?? this.status,
      review: review ?? this.review,
      brokerOrderId: brokerOrderId ?? this.brokerOrderId,
      filledQuantity: filledQuantity ?? this.filledQuantity,
      averageFillPrice: averageFillPrice ?? this.averageFillPrice,
      error: error ?? this.error,
    );
  }
}
