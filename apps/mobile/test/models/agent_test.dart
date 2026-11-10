import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('agent_parsesLiveMessages', () {
    final list =
        jsonDecode(File('test/fixtures/messages.json').readAsStringSync())
            as List;
    final messages = list
        .map((m) => ChatMessage.fromJson(m as Map<String, dynamic>))
        .toList();

    expect(messages, hasLength(6));
    final assistant = messages.firstWhere((m) => m.role == ChatRole.assistant);
    expect(assistant.text, startsWith('Protect retained holdings'));
    final tool = messages.firstWhere(
      (m) => m.role == ChatRole.tool && m.toolName == 'codemode',
    );
    expect(tool.code, isNotNull);
    expect(tool.code, contains('get_risk_state'));
  });

  test('agent_parsesSubagentRun', () {
    final list =
        jsonDecode(File('test/fixtures/subagents.json').readAsStringSync())
            as List;
    final run = SubagentRun.fromJson(list.single as Map<String, dynamic>);

    expect(run.id, 'child-handbuilt-001');
    expect(run.role, SubagentRole.bear);
    expect(run.status, SubagentStatus.done);
    expect(run.task, contains('SPY'));
    expect(run.answer, contains('VIX'));
  });

  test('agent_parsesCompactionRoleAndStatus', () {
    const compacting = {
      'id': 'k1',
      'at': 7000,
      'role': 'compaction',
      'text': 'Context compacted',
    };
    expect(ChatMessage.fromJson(compacting).role, ChatRole.compaction);

    AgentStatus status(Map<String, dynamic> agent) => AgentStatus.fromJson(agent);
    final base = Map<String, dynamic>.from(
      jsonDecode(File('test/fixtures/status.json').readAsStringSync())['agent'] as Map,
    );
    expect(status({...base}).compaction, isNull, reason: 'absent field reads as no live compaction');
    expect(status({...base, 'compaction': 'compacting'}).compaction, AgentCompaction.compacting);
    expect(status({...base, 'compaction': 'failed'}).compaction, AgentCompaction.failed);
    expect(status({...base, 'compaction': 'summarizing'}).compaction, isNull);
    expect(status({...base, 'compaction': null}).compaction, isNull);
  });

  test('agent_compactionCopyWithClearsAndKeeps', () {
    const live = AgentStatus(state: AgentState.running, model: 'm', compaction: AgentCompaction.compacting);

    expect(live.copyWith(compaction: () => null).compaction, isNull);
    expect(live.copyWith(state: AgentState.idle).compaction, AgentCompaction.compacting);
  });

  test('agent_copyWithKeepsIdentity', () {
    final list =
        jsonDecode(File('test/fixtures/subagents.json').readAsStringSync())
            as List;
    final run = SubagentRun.fromJson(list.single as Map<String, dynamic>);

    final failed = run.copyWith(status: SubagentStatus.failed);

    expect(failed.status, SubagentStatus.failed);
    expect(failed.id, run.id);
    expect(failed.answer, run.answer);
  });
}
