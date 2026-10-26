import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('events_parsesAllVariants', () {
    final lines = File('test/fixtures/events.jsonl').readAsLinesSync();
    final events = lines.map(ServerEvent.tryParse).toList();

    expect(lines, hasLength(11));
    expect(events, everyElement(isNotNull));

    final status = events[0] as StatusEvent;
    expect(status.status.agent.state, AgentState.idle);

    final message = events[1] as MessageEvent;
    expect(message.conversationId, 'child-handbuilt-001');
    expect(message.simRunId, isNull);
    expect(message.message.role, ChatRole.assistant);

    final delta = events[2] as DeltaEvent;
    expect(delta.text, isNotEmpty);
    expect(delta.simRunId, isNotNull);

    final subagent = events[3] as SubagentEvent;
    expect(subagent.run.role, SubagentRole.bear);
    expect(subagent.simRunId, isNull);

    final calls = events[4] as CallsEvent;
    expect(calls.calls, hasLength(2));
    expect(calls.calls.first.name, 'get_equity_quotes');
    expect(calls.conversationId, 'child-handbuilt-001');

    final journal = events[5] as JournalEvent;
    expect(journal.entry.action, JournalAction.hold);
    expect(journal.simRunId, isNull);

    final order = events[6] as OrderEvent;
    expect(order.order.id, 'ord-handbuilt-001');
    expect(order.simRunId, isNull);

    final note = events[7] as NoteEvent;
    expect(note.note.path, 'README.md');

    final sim = events[8] as SimEvent;
    expect(sim.run.status, SimRunStatus.done);

    final report = events[9] as ReportEvent;
    expect(report.report.kind, ReportKind.trade);

    final suite = events[10] as SimSuiteEvent;
    expect(suite.suite.config.variants, hasLength(2));
  });

  test('events_rejectsMalformedAndUnknownInput', () {
    expect(ServerEvent.tryParse('not json'), isNull);
    expect(ServerEvent.tryParse('[]'), isNull);
    expect(ServerEvent.tryParse('{"type":"nope"}'), isNull);
    // Right type but missing payload: a broken server frame, never a crash.
    expect(ServerEvent.tryParse('{"type":"message"}'), isNull);
    expect(ServerEvent.tryParse('{"type":"delta"}'), isNull);
  });
}
