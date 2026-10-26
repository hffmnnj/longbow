// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'account.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

BrokerStatus _$BrokerStatusFromJson(Map<String, dynamic> json) => BrokerStatus(
  state: $enumDecode(
    _$BrokerStateEnumMap,
    json['state'],
    unknownValue: BrokerState.disconnected,
  ),
  tools: (json['tools'] as List<dynamic>).map((e) => e as String).toList(),
  error: json['error'] as String?,
);

const _$BrokerStateEnumMap = {
  BrokerState.disconnected: 'disconnected',
  BrokerState.needsAuth: 'needs_auth',
  BrokerState.connecting: 'connecting',
  BrokerState.connected: 'connected',
  BrokerState.error: 'error',
};

Position _$PositionFromJson(Map<String, dynamic> json) => Position(
  symbol: json['symbol'] as String,
  quantity: (json['quantity'] as num).toDouble(),
  sharesAvailableForSells: (json['sharesAvailableForSells'] as num?)
      ?.toDouble(),
  averageCost: (json['averageCost'] as num).toDouble(),
  marketValue: (json['marketValue'] as num).toDouble(),
  unrealizedPnl: (json['unrealizedPnl'] as num).toDouble(),
  sector: json['sector'] as String?,
);

AccountSnapshot _$AccountSnapshotFromJson(Map<String, dynamic> json) =>
    AccountSnapshot(
      at: (json['at'] as num).toInt(),
      equity: (json['equity'] as num).toDouble(),
      cash: (json['cash'] as num).toDouble(),
      buyingPower: (json['buyingPower'] as num).toDouble(),
      settledCash: (json['settledCash'] as num?)?.toDouble(),
      positions: (json['positions'] as List<dynamic>)
          .map((e) => Position.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
