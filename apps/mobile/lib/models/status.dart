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

@JsonSerializable(createToJson: false)
class StatusResponse {
  const StatusResponse({
    required this.agent,
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
