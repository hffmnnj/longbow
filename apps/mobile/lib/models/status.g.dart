// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'status.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ModelsInfo _$ModelsInfoFromJson(Map<String, dynamic> json) => ModelsInfo(
  main: json['main'] as String,
  subagents: json['subagents'] as String,
);

SystemOneStatus _$SystemOneStatusFromJson(Map<String, dynamic> json) =>
    SystemOneStatus(
      state: $enumDecode(
        _$SystemOneStateEnumMap,
        json['state'],
        unknownValue: SystemOneState.unconfigured,
      ),
      model: json['model'] as String,
      calls24h: (json['calls24h'] as num).toInt(),
      medianLatencyMs: (json['medianLatencyMs'] as num?)?.toInt(),
      inputTokens24h: (json['inputTokens24h'] as num).toInt(),
      cooldownUntil: (json['cooldownUntil'] as num?)?.toInt(),
      lastError: json['lastError'] as String?,
      lastOkAt: (json['lastOkAt'] as num?)?.toInt(),
    );

const _$SystemOneStateEnumMap = {
  SystemOneState.ok: 'ok',
  SystemOneState.degraded: 'degraded',
  SystemOneState.rateLimited: 'rate_limited',
  SystemOneState.payment: 'payment',
  SystemOneState.unconfigured: 'unconfigured',
};

StatusResponse _$StatusResponseFromJson(Map<String, dynamic> json) =>
    StatusResponse(
      agent: AgentStatus.fromJson(json['agent'] as Map<String, dynamic>),
      systemOne: json['systemOne'] == null
          ? null
          : SystemOneStatus.fromJson(json['systemOne'] as Map<String, dynamic>),
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
