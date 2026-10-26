import 'package:json_annotation/json_annotation.dart';

part 'account.g.dart';

// Unknown broker states read as disconnected: the app must not assume trading works.
enum BrokerState {
  @JsonValue('disconnected')
  disconnected,
  @JsonValue('needs_auth')
  needsAuth,
  @JsonValue('connecting')
  connecting,
  @JsonValue('connected')
  connected,
  @JsonValue('error')
  error,
}

@JsonSerializable(createToJson: false)
class BrokerStatus {
  const BrokerStatus({required this.state, required this.tools, this.error});

  factory BrokerStatus.fromJson(Map<String, dynamic> json) =>
      _$BrokerStatusFromJson(json);

  @JsonKey(unknownEnumValue: BrokerState.disconnected)
  final BrokerState state;

  /// Robinhood MCP tool names visible after connect.
  final List<String> tools;
  final String? error;
}

@JsonSerializable(createToJson: false)
class Position {
  const Position({
    required this.symbol,
    required this.quantity,
    this.sharesAvailableForSells,
    required this.averageCost,
    required this.marketValue,
    required this.unrealizedPnl,
    this.sector,
  });

  factory Position.fromJson(Map<String, dynamic> json) =>
      _$PositionFromJson(json);

  final String symbol;
  final double quantity;
  final double? sharesAvailableForSells;
  final double averageCost;
  final double marketValue;
  final double unrealizedPnl;
  final String? sector;
}

@JsonSerializable(createToJson: false)
class AccountSnapshot {
  const AccountSnapshot({
    required this.at,
    required this.equity,
    required this.cash,
    required this.buyingPower,
    this.settledCash,
    required this.positions,
  });

  factory AccountSnapshot.fromJson(Map<String, dynamic> json) =>
      _$AccountSnapshotFromJson(json);

  final int at;
  final double equity;
  final double cash;
  final double buyingPower;
  final double? settledCash;
  final List<Position> positions;
}
