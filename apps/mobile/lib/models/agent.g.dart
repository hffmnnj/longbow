// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'agent.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AgentStatus _$AgentStatusFromJson(Map<String, dynamic> json) => AgentStatus(
  state: $enumDecode(
    _$AgentStateEnumMap,
    json['state'],
    unknownValue: AgentState.idle,
  ),
  model: json['model'] as String,
  lastCycleAt: (json['lastCycleAt'] as num?)?.toInt(),
  lastCycleKind: $enumDecodeNullable(
    _$CycleKindEnumMap,
    json['lastCycleKind'],
    unknownValue: CycleKind.manual,
  ),
  nextCycleAt: (json['nextCycleAt'] as num?)?.toInt(),
  nextCycleKind: $enumDecodeNullable(
    _$CycleKindEnumMap,
    json['nextCycleKind'],
    unknownValue: CycleKind.manual,
  ),
  lastError: json['lastError'] as String?,
);

const _$AgentStateEnumMap = {
  AgentState.idle: 'idle',
  AgentState.running: 'running',
  AgentState.error: 'error',
  AgentState.needsLogin: 'needs_login',
};

const _$CycleKindEnumMap = {
  CycleKind.preOpen: 'pre_open',
  CycleKind.intraday: 'intraday',
  CycleKind.postClose: 'post_close',
  CycleKind.overnight: 'overnight',
  CycleKind.manual: 'manual',
};

ToolCallSummary _$ToolCallSummaryFromJson(Map<String, dynamic> json) =>
    ToolCallSummary(
      name: json['name'] as String,
      isError: json['isError'] as bool?,
      summary: json['summary'] as String?,
      durationMs: (json['durationMs'] as num?)?.toInt(),
    );

ChatMessage _$ChatMessageFromJson(Map<String, dynamic> json) => ChatMessage(
  id: json['id'] as String,
  at: (json['at'] as num).toInt(),
  role: $enumDecode(
    _$ChatRoleEnumMap,
    json['role'],
    unknownValue: ChatRole.assistant,
  ),
  text: json['text'] as String,
  toolName: json['toolName'] as String?,
  isError: json['isError'] as bool?,
  code: json['code'] as String?,
  calls: (json['calls'] as List<dynamic>?)
      ?.map((e) => ToolCallSummary.fromJson(e as Map<String, dynamic>))
      .toList(),
  childConversationId: json['childConversationId'] as String?,
  agentRole: json['agentRole'] as String?,
  helperName: json['helperName'] as String?,
);

const _$ChatRoleEnumMap = {
  ChatRole.user: 'user',
  ChatRole.assistant: 'assistant',
  ChatRole.tool: 'tool',
  ChatRole.cycle: 'cycle',
  ChatRole.helper: 'helper',
};

SubagentRun _$SubagentRunFromJson(Map<String, dynamic> json) => SubagentRun(
  id: json['id'] as String,
  role: $enumDecode(
    _$SubagentRoleEnumMap,
    json['role'],
    unknownValue: SubagentRole.analyst,
  ),
  name: json['name'] as String?,
  background: json['background'] as bool?,
  symbol: json['symbol'] as String?,
  task: json['task'] as String,
  startedAt: (json['startedAt'] as num).toInt(),
  endedAt: (json['endedAt'] as num?)?.toInt(),
  status: $enumDecode(
    _$SubagentStatusEnumMap,
    json['status'],
    unknownValue: SubagentStatus.failed,
  ),
  answer: json['answer'] as String?,
);

const _$SubagentRoleEnumMap = {
  SubagentRole.analyst: 'analyst',
  SubagentRole.bull: 'bull',
  SubagentRole.bear: 'bear',
  SubagentRole.riskReviewer: 'risk_reviewer',
  SubagentRole.researcher: 'researcher',
};

const _$SubagentStatusEnumMap = {
  SubagentStatus.running: 'running',
  SubagentStatus.done: 'done',
  SubagentStatus.failed: 'failed',
};
