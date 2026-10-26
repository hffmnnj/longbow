import 'package:json_annotation/json_annotation.dart';

part 'agent.g.dart';

// Unknown cycle kinds read as manual (a human-triggered run, no schedule implied).
enum CycleKind {
  @JsonValue('pre_open')
  preOpen,
  @JsonValue('intraday')
  intraday,
  @JsonValue('post_close')
  postClose,
  @JsonValue('overnight')
  overnight,
  @JsonValue('manual')
  manual,
}

// Unknown agent states read as idle so the UI never shows phantom activity.
enum AgentState {
  @JsonValue('idle')
  idle,
  @JsonValue('running')
  running,
  @JsonValue('error')
  error,
  @JsonValue('needs_login')
  needsLogin,
}

// Unknown roles read as assistant (plain model text, no special handling).
enum ChatRole {
  @JsonValue('user')
  user,
  @JsonValue('assistant')
  assistant,
  @JsonValue('tool')
  tool,
  @JsonValue('cycle')
  cycle,
  @JsonValue('helper')
  helper,
}

// Unknown subagent roles read as analyst, the generic research role.
enum SubagentRole {
  @JsonValue('analyst')
  analyst,
  @JsonValue('bull')
  bull,
  @JsonValue('bear')
  bear,
  @JsonValue('risk_reviewer')
  riskReviewer,
  @JsonValue('researcher')
  researcher,
}

// Unknown run states read as failed: never mistake an unknown state for done.
enum SubagentStatus {
  @JsonValue('running')
  running,
  @JsonValue('done')
  done,
  @JsonValue('failed')
  failed,
}

@JsonSerializable(createToJson: false)
class AgentStatus {
  const AgentStatus({
    required this.state,
    required this.model,
    this.lastCycleAt,
    this.lastCycleKind,
    this.nextCycleAt,
    this.nextCycleKind,
    this.lastError,
  });

  factory AgentStatus.fromJson(Map<String, dynamic> json) =>
      _$AgentStatusFromJson(json);

  @JsonKey(unknownEnumValue: AgentState.idle)
  final AgentState state;
  final String model;
  final int? lastCycleAt;
  @JsonKey(unknownEnumValue: CycleKind.manual)
  final CycleKind? lastCycleKind;
  final int? nextCycleAt;
  @JsonKey(unknownEnumValue: CycleKind.manual)
  final CycleKind? nextCycleKind;
  final String? lastError;

  AgentStatus copyWith({
    AgentState? state,
    String? model,
    int? lastCycleAt,
    CycleKind? lastCycleKind,
    int? nextCycleAt,
    CycleKind? nextCycleKind,
    String? lastError,
  }) {
    return AgentStatus(
      state: state ?? this.state,
      model: model ?? this.model,
      lastCycleAt: lastCycleAt ?? this.lastCycleAt,
      lastCycleKind: lastCycleKind ?? this.lastCycleKind,
      nextCycleAt: nextCycleAt ?? this.nextCycleAt,
      nextCycleKind: nextCycleKind ?? this.nextCycleKind,
      lastError: lastError ?? this.lastError,
    );
  }
}

/// One tool call a Code Mode script made, shown nested under the script.
@JsonSerializable(createToJson: false)
class ToolCallSummary {
  const ToolCallSummary({
    required this.name,
    this.isError,
    this.summary,
    this.durationMs,
  });

  factory ToolCallSummary.fromJson(Map<String, dynamic> json) =>
      _$ToolCallSummaryFromJson(json);

  final String name;
  final bool? isError;

  /// Short human summary of the arguments or result.
  final String? summary;
  final int? durationMs;
}

@JsonSerializable(createToJson: false)
class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.at,
    required this.role,
    required this.text,
    this.toolName,
    this.isError,
    this.code,
    this.calls,
    this.childConversationId,
    this.agentRole,
    this.helperName,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) =>
      _$ChatMessageFromJson(json);

  final String id;
  final int at;
  @JsonKey(unknownEnumValue: ChatRole.assistant)
  final ChatRole role;
  final String text;
  final String? toolName;
  final bool? isError;

  /// For `codemode` tool messages: the script the agent ran.
  final String? code;

  /// For `codemode` tool messages: the nested tool calls the script made, in order.
  final List<ToolCallSummary>? calls;

  /// For `delegate` tool messages: the subagent conversation, readable at GET /api/conversations/:id/messages.
  final String? childConversationId;

  /// For `delegate` tool messages and helper reports: the subagent role, for example "bear".
  final String? agentRole;

  /// For helper reports: the long-running helper's name.
  final String? helperName;

  ChatMessage copyWith({
    String? id,
    int? at,
    ChatRole? role,
    String? text,
    String? toolName,
    bool? isError,
    String? code,
    List<ToolCallSummary>? calls,
    String? childConversationId,
    String? agentRole,
    String? helperName,
  }) {
    return ChatMessage(
      id: id ?? this.id,
      at: at ?? this.at,
      role: role ?? this.role,
      text: text ?? this.text,
      toolName: toolName ?? this.toolName,
      isError: isError ?? this.isError,
      code: code ?? this.code,
      calls: calls ?? this.calls,
      childConversationId: childConversationId ?? this.childConversationId,
      agentRole: agentRole ?? this.agentRole,
      helperName: helperName ?? this.helperName,
    );
  }
}

/// One `delegate` run, or one named long-running `subagent` helper: a read-only
/// conversation working for the lead agent.
@JsonSerializable(createToJson: false)
class SubagentRun {
  const SubagentRun({
    required this.id,
    required this.role,
    this.name,
    this.background,
    this.symbol,
    required this.task,
    required this.startedAt,
    this.endedAt,
    required this.status,
    this.answer,
  });

  factory SubagentRun.fromJson(Map<String, dynamic> json) =>
      _$SubagentRunFromJson(json);

  /// The child conversation id; its transcript is GET /api/conversations/:id/messages.
  final String id;
  @JsonKey(unknownEnumValue: SubagentRole.analyst)
  final SubagentRole role;

  /// Long-running helpers only: the name the lead agent gave it.
  final String? name;

  /// True for a long-running helper that keeps its context between messages; "done" then means idle and ready for more.
  final bool? background;
  final String? symbol;
  final String task;
  final int startedAt;
  final int? endedAt;
  @JsonKey(unknownEnumValue: SubagentStatus.failed)
  final SubagentStatus status;

  /// Final answer, when done.
  final String? answer;

  SubagentRun copyWith({
    String? id,
    SubagentRole? role,
    String? name,
    bool? background,
    String? symbol,
    String? task,
    int? startedAt,
    int? endedAt,
    SubagentStatus? status,
    String? answer,
  }) {
    return SubagentRun(
      id: id ?? this.id,
      role: role ?? this.role,
      name: name ?? this.name,
      background: background ?? this.background,
      symbol: symbol ?? this.symbol,
      task: task ?? this.task,
      startedAt: startedAt ?? this.startedAt,
      endedAt: endedAt ?? this.endedAt,
      status: status ?? this.status,
      answer: answer ?? this.answer,
    );
  }
}
