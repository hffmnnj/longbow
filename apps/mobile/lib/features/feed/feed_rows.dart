import 'package:flutter/material.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/steps.dart';
import 'package:longbow/domain/tool_meta.dart';
import 'package:longbow/models/models.dart';

import 'compaction_card.dart';
import 'decision_card.dart';
import 'tool_calls.dart';
import 'transcript_items.dart';
import 'work_step.dart';

/// One keyed row of the transcript list.
class FeedRow {
  const FeedRow(this.key, this.widget);

  final String key;
  final Widget widget;
}

/// Everything needed to turn a transcript into rows, except the streaming
/// draft (drawn separately so a delta never rebuilds the rows).
class FeedRowsInput {
  const FeedRowsInput({
    required this.messages,
    this.journal = const [],
    this.orders = const [],
    this.subagents = const [],
    this.calls = const [],
    this.outbox = const [],
    this.running = false,
    this.compaction,
    this.simRunId,
    this.agentLabel = 'Agent',
    this.onRetry,
    this.onDiscard,
  });

  final List<ChatMessage> messages;
  final List<JournalEntry> journal;
  final List<OrderRecord> orders;
  final List<SubagentRun> subagents;

  /// Live nested calls for the trailing running script.
  final List<ToolCallSummary> calls;
  final List<OutboxItem> outbox;
  final bool running;

  /// Live lead compaction from the root status; child and sim transcripts
  /// leave this unset so the lead card never leaks into another feed.
  final AgentCompaction? compaction;
  final String? simRunId;
  final String agentLabel;
  final void Function(OutboxItem item)? onRetry;
  final void Function(String id)? onDiscard;
}

/// Result of [buildFeedRows]: the rows plus whether a "Working" indicator is
/// owed while no draft streams (the running step already shows its own), and
/// the newest running call's title for that indicator when there is one.
class FeedRows {
  const FeedRows(this.rows, {required this.showWorking, this.workingLabel});

  final List<FeedRow> rows;
  final bool showWorking;

  /// Readable current-call label for the tail indicator, if the stream has
  /// live nested calls but no live step owns them.
  final String? workingLabel;
}

Widget _gap(Widget child, {double top = 0}) => Padding(padding: EdgeInsets.only(top: top, bottom: 12), child: child);

/// Port of the item loop in Transcript.svelte: folds messages into steps,
/// tool groups and decisions, then maps each to its widget.
FeedRows buildFeedRows(FeedRowsInput input) {
  final items = withDecisions(buildItems(input.messages), input.journal);
  final orderById = {for (final o in input.orders) o.id: o};
  final liveKey = input.running ? liveStepKey(items) : null;
  String? lastStepKey;
  for (var i = items.length - 1; i >= 0; i--) {
    if (items[i].kind == FeedKind.step) {
      lastStepKey = items[i].key;
      break;
    }
  }
  final lastIsLiveStep = liveKey != null && liveKey == lastStepKey;

  final rows = <FeedRow>[];
  for (final item in items) {
    final Widget w;
    switch (item) {
      case FeedMessage(:final message):
        w = switch (message.role) {
          ChatRole.cycle => _gap(CycleDivider(message: message), top: 8),
          ChatRole.user => _gap(UserBubble(text: message.text, at: message.at)),
          ChatRole.helper => _gap(HelperReportCard(message: message)),
          // The committed compaction marker: fixed label and timestamp, never
          // the stored text (the server strips summaries from API chat).
          ChatRole.compaction => _gap(CompactionCard.completed(at: message.at)),
          ChatRole.assistant => _gap(AssistantMessage(text: message.text, at: message.at, label: input.agentLabel)),
          ChatRole.tool => _gap(ToolTrace(messages: [message], orders: input.orders, simRunId: input.simRunId)),
        };
      case FeedStep():
        w = _gap(WorkStep(
          code: item.code,
          result: item.result,
          live: item.key == liveKey,
          liveCalls: input.calls,
          subagents: input.subagents,
          simRunId: input.simRunId,
        ));
      case FeedDecision(:final entry):
        w = _gap(DecisionCard(
          entry: entry,
          order: entry.orderId == null ? null : orderById[entry.orderId],
          linkable: input.simRunId == null,
        ));
      case FeedTools(:final messages):
        w = _gap(ToolTrace(messages: messages, orders: input.orders, simRunId: input.simRunId));
    }
    rows.add(FeedRow(item.key, w));
  }
  for (final o in input.outbox) {
    rows.add(FeedRow(
      'outbox-${o.id}',
      _gap(OutboxBubble(
        text: o.text,
        at: o.at,
        failed: o.failed,
        onRetry: () => input.onRetry?.call(o),
        onDiscard: () => input.onDiscard?.call(o.id),
      )),
    ));
  }
  // A live compaction card replaces the generic Working indicator: showing
  // both would read as two agents working.
  final showWorking = input.running && !lastIsLiveStep && input.compaction != AgentCompaction.compacting;
  String? workingLabel;
  if (showWorking && input.calls.isNotEmpty) {
    ToolCallSummary? current;
    for (var i = input.calls.length - 1; i >= 0; i--) {
      if (isRunning(input.calls[i])) {
        current = input.calls[i];
        break;
      }
    }
    current ??= input.calls.last;
    workingLabel = toolTitle(current.name, current.summary);
  }
  return FeedRows(rows, showWorking: showWorking, workingLabel: workingLabel);
}
