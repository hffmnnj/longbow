// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'status.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ModelsInfo _$ModelsInfoFromJson(Map<String, dynamic> json) => ModelsInfo(
  main: json['main'] as String,
  subagents: json['subagents'] as String,
);

StatusResponse _$StatusResponseFromJson(Map<String, dynamic> json) =>
    StatusResponse(
      agent: AgentStatus.fromJson(json['agent'] as Map<String, dynamic>),
      broker: BrokerStatus.fromJson(json['broker'] as Map<String, dynamic>),
      market: MarketClock.fromJson(json['market'] as Map<String, dynamic>),
      settings: Settings.fromJson(json['settings'] as Map<String, dynamic>),
      account: json['account'] == null
          ? null
          : AccountSnapshot.fromJson(json['account'] as Map<String, dynamic>),
      halts: (json['halts'] as List<dynamic>)
          .map(
            (e) => $enumDecode(
              _$HaltReasonEnumMap,
              e,
              unknownValue: HaltReason.brokerDisconnected,
            ),
          )
          .toList(),
      dayPnl: (json['dayPnl'] as num?)?.toDouble(),
      dayPnlPct: (json['dayPnlPct'] as num?)?.toDouble(),
      liveTrading: json['liveTrading'] as bool,
      models: ModelsInfo.fromJson(json['models'] as Map<String, dynamic>),
    );

const _$HaltReasonEnumMap = {
  HaltReason.killSwitch: 'kill_switch',
  HaltReason.modeOff: 'mode_off',
  HaltReason.dailyLoss: 'daily_loss',
  HaltReason.drawdown: 'drawdown',
  HaltReason.brokerDisconnected: 'broker_disconnected',
};
