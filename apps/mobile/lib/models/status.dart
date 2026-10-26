import 'package:json_annotation/json_annotation.dart';

import 'account.dart';
import 'agent.dart';
import 'market.dart';
import 'settings.dart';

part 'status.g.dart';

// Unknown halt reasons block entries: fail closed, never fail open.
enum HaltReason {
  @JsonValue('kill_switch')
  killSwitch,
  @JsonValue('mode_off')
  modeOff,
  @JsonValue('daily_loss')
  dailyLoss,
  @JsonValue('drawdown')
  drawdown,
  @JsonValue('broker_disconnected')
  brokerDisconnected,
}

/// Model specs as "provider/model#thinking": the lead agent and the subagent fleet.
@JsonSerializable(createToJson: false)
class ModelsInfo {
  const ModelsInfo({required this.main, required this.subagents});

  factory ModelsInfo.fromJson(Map<String, dynamic> json) =>
      _$ModelsInfoFromJson(json);

  final String main;
  final String subagents;
}

// Unknown System One states read as unconfigured: no reviews claimed.
enum SystemOneState {
  @JsonValue('ok')
  ok,
  @JsonValue('degraded')
  degraded,
  @JsonValue('rate_limited')
  rateLimited,
  @JsonValue('payment')
  payment,
  @JsonValue('unconfigured')
  unconfigured,
}

/// Health of the System One (decision model) connection. Mirrors TS
/// SystemOneStatus: `rate_limited` and `payment` may carry a `cooldownUntil`.
@JsonSerializable(createToJson: false)
class SystemOneStatus {
  const SystemOneStatus({
    required this.state,
    required this.model,
    required this.calls24h,
    this.medianLatencyMs,
    required this.inputTokens24h,
    this.cooldownUntil,
    this.lastError,
    this.lastOkAt,
  });

  factory SystemOneStatus.fromJson(Map<String, dynamic> json) =>
      _$SystemOneStatusFromJson(json);

  @JsonKey(unknownEnumValue: SystemOneState.unconfigured)
  final SystemOneState state;

  /// Model id sent on the wire, such as jev-latest.
  final String model;

  /// Calls answered in the last 24 hours, and the median latency of the
  /// last 200 (absent when unknown).
  final int calls24h;
  final int? medianLatencyMs;

  /// Input tokens billed in the last 24 hours.
  final int inputTokens24h;
  final int? cooldownUntil;
  final String? lastError;
  final int? lastOkAt;
}

@JsonSerializable(createToJson: false)
class StatusResponse {
  const StatusResponse({
    required this.agent,
    this.systemOne,
    required this.broker,
    required this.market,
    required this.settings,
    required this.account,
    required this.halts,
    this.dayPnl,
    this.dayPnlPct,
    required this.liveTrading,
    required this.models,
  });

  factory StatusResponse.fromJson(Map<String, dynamic> json) =>
      _$StatusResponseFromJson(json);

  final AgentStatus agent;

  /// Absent on servers older than System One.
  final SystemOneStatus? systemOne;
  final BrokerStatus broker;
  final MarketClock market;
  final Settings settings;
  final AccountSnapshot? account;
  @JsonKey(unknownEnumValue: HaltReason.brokerDisconnected)
  final List<HaltReason> halts;

  /// P&L vs the ET day's starting equity, when known.
  final double? dayPnl;
  final double? dayPnlPct;

  /// False while the server's hard lock keeps Robinhood read-only
  /// (HARNESS_LIVE_TRADING unset), whatever the mode.
  final bool liveTrading;
  final ModelsInfo models;

  StatusResponse copyWith({
    AgentStatus? agent,
    SystemOneStatus? systemOne,
    BrokerStatus? broker,
    MarketClock? market,
    Settings? settings,
    AccountSnapshot? account,
    List<HaltReason>? halts,
    double? dayPnl,
    double? dayPnlPct,
    bool? liveTrading,
    ModelsInfo? models,
  }) {
    return StatusResponse(
      agent: agent ?? this.agent,
      systemOne: systemOne ?? this.systemOne,
      broker: broker ?? this.broker,
      market: market ?? this.market,
      settings: settings ?? this.settings,
      account: account ?? this.account,
      halts: halts ?? this.halts,
      dayPnl: dayPnl ?? this.dayPnl,
      dayPnlPct: dayPnlPct ?? this.dayPnlPct,
      liveTrading: liveTrading ?? this.liveTrading,
      models: models ?? this.models,
    );
  }
}
