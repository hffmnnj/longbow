import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/state/feed_reducer.dart';
import 'package:longbow/models/models.dart';

ChatMessage msg(String id, int at, ChatRole role, [String? text]) =>
    ChatMessage(id: id, at: at, role: role, text: text ?? id);

JournalEntry entry(String id, int at, [String? summary]) => JournalEntry(
      id: id,
      at: at,
      action: JournalAction.hold,
      summary: summary ?? id,
      rationale: 'r',
      evidence: const [],
    );

OrderRecord order(String id, OrderStatus status, int createdAt) => OrderRecord(
      id: id,
      createdAt: createdAt,
      updatedAt: createdAt,
      intent: const OrderIntent(
        symbol: 'SPY',
        side: OrderSide.buy,
        quantity: 2,
        orderType: OrderType.limit,
        limitPrice: 500,
        timeInForce: TimeInForce.day,
        invalidationPrice: 490,
        timeStopDate: '2026-10-26',
        thesis: 't',
        probabilityWin: 0.6,
        expectedGainPct: 2,
        expectedLossPct: 1,
        estimatedCostPct: 0.1,
        evidence: [],
      ),
      verdict: const RiskVerdict(approved: true, isExit: false, checks: []),
      status: status,
    );

StatusResponse statusWith(AgentState agentState) => StatusResponse(
      agent: AgentStatus(state: agentState, model: 'main'),
      broker: const BrokerStatus(state: BrokerState.disconnected, tools: []),
      market: const MarketClock(
        now: 1,
        session: MarketSession.closed,
        isOpen: false,
        tradingDay: '2026-10-26',
        nextOpen: 2,
        nextClose: 3,
        earlyClose: false,
      ),
      settings: defaultSettings,
      account: null,
      halts: const [],
      liveTrading: false,
      models: const ModelsInfo(main: 'a', subagents: 'b'),
    );

SubagentRun run(String id, int startedAt,
        [SubagentStatus status = SubagentStatus.running]) =>
    SubagentRun(
      id: id,
      role: SubagentRole.bull,
      task: 't',
      startedAt: startedAt,
      status: status,
    );

ToolCallSummary call(String name, [int? durationMs]) =>
    ToolCallSummary(name: name, durationMs: durationMs);

void main() {
  group('applyEvent', () {
    test('replaces status wholesale', () {
      final a = statusWith(AgentState.idle);
      final b = statusWith(AgentState.running);
      final s = applyEvent(
        applyEvent(emptyState(), StatusEvent(a)),
        StatusEvent(b),
      );
      expect(s.status, same(b));
    });

    test('upserts messages by id and keeps chronological order', () {
      var s = emptyState();
      s = applyEvent(s, MessageEvent(msg('b', 20, ChatRole.user)));
      s = applyEvent(s, MessageEvent(msg('a', 10, ChatRole.cycle)));
      s = applyEvent(
          s, MessageEvent(msg('b', 20, ChatRole.user, 'edited')));
      expect(s.messages.map((m) => m.id), ['a', 'b']);
      expect(s.messages[1].text, 'edited');
    });

    test('accumulates deltas until the committed assistant message arrives',
        () {
      var s = emptyState();
      s = applyEvent(s, const DeltaEvent('Looking at '));
      s = applyEvent(s, const DeltaEvent('SPY.'));
      expect(s.draft, 'Looking at SPY.');
      s = applyEvent(s, MessageEvent(msg('t1', 5, ChatRole.tool)));
      expect(s.draft, 'Looking at SPY.');
      s = applyEvent(
          s, MessageEvent(msg('m1', 6, ChatRole.assistant, 'Looking at SPY.')));
      expect(s.draft, '');
      expect(s.messages, hasLength(2));
    });

    test('drops a stale draft when the agent stops running', () {
      var s = applyEvent(emptyState(), const DeltaEvent('partial'));
      s = applyEvent(s, StatusEvent(statusWith(AgentState.running)));
      expect(s.draft, 'partial');
      s = applyEvent(s, StatusEvent(statusWith(AgentState.idle)));
      expect(s.draft, '');
    });

    test('keeps journal and orders newest first and updates in place', () {
      var s = emptyState();
      s = applyEvent(s, JournalEvent(entry('j1', 100)));
      s = applyEvent(s, JournalEvent(entry('j2', 200)));
      s = applyEvent(s, JournalEvent(entry('j1', 100, 'updated')));
      expect(s.journal.map((j) => j.id), ['j2', 'j1']);
      expect(s.journal[1].summary, 'updated');

      final o1 = order('o1', OrderStatus.pendingApproval, 1);
      final o2 = order('o2', OrderStatus.pendingApproval, 2);
      s = applyEvent(s, OrderEvent(o1));
      s = applyEvent(s, OrderEvent(o2));
      s = applyEvent(
          s, OrderEvent(o1.copyWith(status: OrderStatus.submitted)));
      expect(s.orders.map((o) => o.id), ['o2', 'o1']);
      expect(s.orders[1].status, OrderStatus.submitted);
    });

    test('does not mutate the previous state', () {
      final before = emptyState();
      applyEvent(before, const DeltaEvent('x'));
      expect(before.draft, '');
    });

    test('ignores sim and sim-scoped events', () {
      var s = applyEvent(emptyState(), const DeltaEvent('lead '));
      s = applyEvent(
          s,
          MessageEvent(msg('m', 1, ChatRole.user),
              simRunId: 'run-1'));
      expect(s.messages, isEmpty);
      expect(s.draft, 'lead ');
    });
  });

  group('applyEvent: agent work', () {
    ChatMessage codeMsg(String id, int at) => ChatMessage(
        id: id,
        at: at,
        role: ChatRole.tool,
        text: id,
        toolName: 'codemode',
        code: 'run()');
    ChatMessage resultMsg(String id, int at) => ChatMessage(
        id: id,
        at: at,
        role: ChatRole.tool,
        text: id,
        toolName: 'codemode',
        calls: [call('a', 5)]);

    test('keeps live calls while the script runs and replaces them after',
        () {
      var s =
          applyEvent(emptyState(), CallsEvent([call('a'), call('b', 9)]));
      expect(s.calls, hasLength(2));
      s = applyEvent(s, MessageEvent(codeMsg('c1', 1)));
      expect(s.calls, hasLength(2));
      s = applyEvent(s, MessageEvent(resultMsg('c2', 2)));
      expect(s.calls, isEmpty);
    });

    test('upserts subagent runs newest first', () {
      var s = applyEvent(emptyState(), SubagentEvent(run('x', 10)));
      s = applyEvent(s, SubagentEvent(run('y', 20)));
      s = applyEvent(
          s, SubagentEvent(run('x', 10, SubagentStatus.done)));
      expect(
          s.subagents.map((r) => [r.id, r.status]),
          [
            ['y', SubagentStatus.running],
            ['x', SubagentStatus.done],
          ]);
    });

    test('routes scoped message, delta and calls to the transcript only',
        () {
      var s = emptyState();
      s = applyEvent(s, const DeltaEvent('lead '));
      s = applyEvent(
          s, const DeltaEvent('bull ', conversationId: 'c-bull'));
      s = applyEvent(
          s, const DeltaEvent('case', conversationId: 'c-bull'));
      s = applyEvent(
          s, CallsEvent([call('q')], conversationId: 'c-bull'));
      expect(s.draft, 'lead ');
      expect(s.calls, isEmpty);
      expect(s.transcripts['c-bull']!.draft, 'bull case');
      expect(s.transcripts['c-bull']!.calls, [isA<ToolCallSummary>()]);

      s = applyEvent(
          s,
          MessageEvent(msg('a1', 5, ChatRole.assistant, 'final'),
              conversationId: 'c-bull'));
      expect(s.messages, isEmpty);
      expect(s.transcripts['c-bull']!.messages.map((m) => m.id), ['a1']);
      expect(s.transcripts['c-bull']!.draft, '');
    });

    test('upserts notes by path and sorts them', () {
      var s = emptyState();
      s = applyEvent(
          s, const NoteEvent(NoteFile(path: 'theses/NVDA.md', size: 1, updatedAt: 1)));
      s = applyEvent(
          s, const NoteEvent(NoteFile(path: 'plan.md', size: 1, updatedAt: 2)));
      s = applyEvent(
          s, const NoteEvent(NoteFile(path: 'plan.md', size: 9, updatedAt: 3)));
      expect(
          s.notes.map((n) => [n.path, n.size]),
          [
            ['plan.md', 9],
            ['theses/NVDA.md', 1],
          ]);
    });

    test('drops the matching outbox entry when the user message arrives',
        () {
      var s = addOutbox(
          emptyState(), const OutboxItem(id: 'o1', text: 'hello', at: 1));
      s = addOutbox(
          s, const OutboxItem(id: 'o2', text: 'again', at: 2));
      s = applyEvent(
          s, MessageEvent(msg('u1', 3, ChatRole.user, 'hello')));
      expect(s.outbox.map((o) => o.id), ['o2']);
      expect(failOutbox(s, 'o2').outbox.single.failed, isTrue);
    });

    test('dropOutbox removes by id only', () {
      var s = addOutbox(
          emptyState(), const OutboxItem(id: 'o1', text: 'a', at: 1));
      s = dropOutbox(s, 'missing');
      expect(s.outbox, hasLength(1));
      s = dropOutbox(s, 'o1');
      expect(s.outbox, isEmpty);
    });

    test('mergeTranscript keeps streamed and fetched messages', () {
      var s = applyEvent(
          s0(), const DeltaEvent('x', conversationId: 'c1'));
      s = mergeTranscript(
          s, 'c1', [msg('m1', 1, ChatRole.user), msg('m2', 2, ChatRole.assistant)]);
      expect(s.transcripts['c1']!.messages.map((m) => m.id), ['m1', 'm2']);
      expect(s.transcripts['c1']!.draft, 'x');
    });
  });
}

FeedState s0() => emptyState();
