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

// Unknown contract types read as call; response-only, the app never submits from this.
enum OptionContractType {
  @JsonValue('call')
  call,
  @JsonValue('put')
  put,
}

// Unknown ticket sides read as buy-to-open; response-only, the app never submits from this.
enum OptionTicketSide {
  @JsonValue('buy-to-open')
  buyToOpen,
  @JsonValue('sell-to-close')
  sellToClose,
}

/// Standard 100-share long option terms. Instrument ids are opaque contract
/// ids, never account ids. limitCents is cents per share: one contract costs
/// limitCents dollars at the limit (100 shares cancel the /100).
@JsonSerializable(createToJson: false)
class LongOptionTicket {
  const LongOptionTicket({
    required this.instrumentId,
    required this.symbol,
    required this.expiration,
    required this.strikeCents,
    required this.contractType,
    required this.side,
    required this.contracts,
    required this.limitCents,
  });

  factory LongOptionTicket.fromJson(Map<String, dynamic> json) =>
      _$LongOptionTicketFromJson(json);

  final String instrumentId;
  final String symbol;

  /// Contract expiration, YYYY-MM-DD.
  final String expiration;

  /// Strike in cents per share.
  final int strikeCents;
  @JsonKey(unknownEnumValue: OptionContractType.call)
  final OptionContractType contractType;
  @JsonKey(unknownEnumValue: OptionTicketSide.buyToOpen)
  final OptionTicketSide side;

  /// Whole contracts, 1..100.
  final int contracts;

  /// Limit in cents per share.
  final int limitCents;
}

/// Sentinel for a present-but-unparseable longOption: keeps [isOptionIntent]
/// true while failing validation, so malformed details never render as a
/// stock ticket with an actionable approval.
const _invalidLongOption = LongOptionTicket(
  instrumentId: '',
  symbol: '',
  expiration: '',
  strikeCents: 0,
  contractType: OptionContractType.call,
  side: OptionTicketSide.buyToOpen,
  contracts: 0,
  limitCents: 0,
);

/// Lenient option reader: absent stays absent so existing records parse;
/// present-but-malformed stays present as an invalid ticket instead of
/// throwing the whole order list or coercing unknown enums into a valid
/// looking ticket.
LongOptionTicket? _longOptionFromJson(Object? json) {
  if (json == null) return null;
  if (json is! Map<String, dynamic>) return _invalidLongOption;
  // Strict on the two enums: generated code would coerce an unknown string
  // into a default and hide the mismatch.
  if (json['contractType'] != 'call' && json['contractType'] != 'put') {
    return _invalidLongOption;
  }
  if (json['side'] != 'buy-to-open' && json['side'] != 'sell-to-close') {
    return _invalidLongOption;
  }
  try {
    return LongOptionTicket.fromJson(json);
  } catch (_) {
    return _invalidLongOption;
  }
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
    this.ownerInstruction,
    required this.evidence,
    this.longOption,
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

  /// Verbatim owner chat text used to route this order for human approval.
  /// Absent for agent-initiated orders; unknown fields still parse.
  final String? ownerInstruction;

  /// Citations to tool outputs: tool name plus what it showed and when.
  final List<String> evidence;

  /// Exact long-option terms when this order is an option. Absent for
  /// equity and crypto orders; older records without it still parse.
  /// Present-but-malformed details decode to an invalid ticket (never null)
  /// so the UI shows an option error instead of a stock ticket.
  @JsonKey(fromJson: _longOptionFromJson)
  final LongOptionTicket? longOption;
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
    this.ownerMessageId,
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

  /// Server-recorded chat message matched when routing this order for
  /// approval. Present only on owner-requested orders.
  final String? ownerMessageId;

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
    String? ownerMessageId,
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
      ownerMessageId: ownerMessageId ?? this.ownerMessageId,
      review: review ?? this.review,
      brokerOrderId: brokerOrderId ?? this.brokerOrderId,
      filledQuantity: filledQuantity ?? this.filledQuantity,
      averageFillPrice: averageFillPrice ?? this.averageFillPrice,
      error: error ?? this.error,
    );
  }
}
