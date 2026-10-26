import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/roles.dart';
import 'package:longbow/models/models.dart';

import 'feed_icons.dart';
import 'feed_rows.dart';
import 'trace.dart';
import 'transcript_items.dart';

/// How long a finished subagent stays in the lane (7 s, as web).
const int kLaneLingerMs = 7000;

/// Rows of a subagent transcript rendered inline before pointing at the page.
const int kLaneInlineRows = 30;

/// Subagents that are running, or finished moments ago.
List<SubagentRun> laneRuns(List<SubagentRun> subagents, int now) {
  return subagents
      .where((r) => r.status == SubagentStatus.running || (r.endedAt != null && now - r.endedAt! < kLaneLingerMs))
      .toList()
      .reversed
      .toList();
}

/// The strip above the composer listing running subagents (and long-running
/// helpers) with their latest line. Each opens in place; "Open transcript"
/// goes to the full page. Port of AgentsLane.svelte.
class AgentsLane extends ConsumerWidget {
  const AgentsLane({super.key, required this.feed, required this.loadTranscript, this.simRunId});

  final FeedState feed;
  final Future<void> Function(String conversationId) loadTranscript;
  final String? simRunId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    var now = DateTime.now().millisecondsSinceEpoch;
    var runs = laneRuns(feed.subagents, now);
    // The lingering window needs a ticking clock; running agents do not.
    if (runs.any((r) => r.status != SubagentStatus.running)) {
      now = ref.watch(clockProvider).millisecondsSinceEpoch;
      runs = laneRuns(feed.subagents, now);
    }
    if (runs.isEmpty) return const SizedBox.shrink();
    final c = context.lb;
    final maxHeight = MediaQuery.sizeOf(context).height * 0.4;
    return Semantics(
      container: true,
      label: 'Running agents',
      child: DecoratedBox(
        decoration: BoxDecoration(color: c.bar, border: Border(top: BorderSide(color: c.border))),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxHeight),
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: TraceColumn(
              children: [
                for (final run in runs)
                  _LaneRun(
                    key: ValueKey('lane-${run.id}'),
                    run: run,
                    feed: feed,
                    loadTranscript: loadTranscript,
                    simRunId: simRunId,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LaneRun extends StatefulWidget {
  const _LaneRun({super.key, required this.run, required this.feed, required this.loadTranscript, this.simRunId});

  final SubagentRun run;
  final FeedState feed;
  final Future<void> Function(String) loadTranscript;
  final String? simRunId;

  @override
  State<_LaneRun> createState() => _LaneRunState();
}

class _LaneRunState extends State<_LaneRun> {
  @override
  void initState() {
    super.initState();
    if (widget.run.status == SubagentStatus.running && widget.feed.transcripts[widget.run.id] == null) {
      Future.microtask(() => widget.loadTranscript(widget.run.id));
    }
  }

  String _line() {
    final run = widget.run;
    final t = widget.feed.transcripts[run.id];
    String? lastAssistant;
    ChatMessage? lastTool;
    if (t != null) {
      for (final m in t.messages.reversed) {
        if (lastAssistant == null && m.role == ChatRole.assistant) lastAssistant = m.text;
        if (lastTool == null && m.role == ChatRole.tool) lastTool = m;
        if (lastAssistant != null && lastTool != null) break;
      }
    }
    return latestLine(
      t?.draft,
      run.status == SubagentStatus.done ? (run.answer ?? lastAssistant) : lastAssistant,
      lastTool != null ? '${lastTool.toolName ?? 'tool'}: ${lastTool.text}' : run.task,
    );
  }

  @override
  Widget build(BuildContext context) {
    final run = widget.run;
    final label = roleLabel(run.role);
    final line = _line();
    final status = run.status == SubagentStatus.running
        ? TraceStatus.running
        : run.status == SubagentStatus.failed
            ? TraceStatus.error
            : null;
    return TraceDisclosure(
      icon: roleIconData(roleIcon(run.role)),
      title: '$label${run.symbol != null ? ' on ${run.symbol}' : ''}',
      description: line,
      status: status,
      semanticLabel: '$label${run.symbol != null ? ' on ${run.symbol}' : ''}, ${run.status.name}. $line',
      defaultOpen: run.status == SubagentStatus.running,
      onChanged: (open) {
        if (open && widget.feed.transcripts[run.id] == null) widget.loadTranscript(run.id);
      },
      childBuilder: (context) => SubagentTrace(
        run: run,
        feed: widget.feed,
        simRunId: widget.simRunId,
        maxRows: kLaneInlineRows,
      ),
    );
  }
}

/// A subagent run as its own trace of tool calls plus its final answer
/// (port of SubagentTrace.svelte). Renders the newest [maxRows] rows inline
/// and points at the full page for the rest.
class SubagentTrace extends StatelessWidget {
  const SubagentTrace({super.key, required this.run, required this.feed, this.simRunId, this.maxRows});

  final SubagentRun run;
  final FeedState feed;
  final String? simRunId;
  final int? maxRows;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final transcript = feed.transcripts[run.id];
    if (transcript == null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text('No transcript yet.', style: LbText.muted(context)),
      );
    }
    final answer = run.answer;
    final messages = answer == null
        ? transcript.messages
        : transcript.messages.where((m) => !(m.role == ChatRole.assistant && m.text == answer)).toList();
    final built = buildFeedRows(FeedRowsInput(
      messages: messages,
      orders: feed.orders,
      subagents: feed.subagents,
      calls: transcript.calls,
      running: run.status == SubagentStatus.running,
      simRunId: simRunId,
      agentLabel: roleLabel(run.role),
    ));
    final all = built.rows;
    final shown = maxRows != null && all.length > maxRows! ? all.sublist(all.length - maxRows!) : all;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (shown.length < all.length)
          Align(
            alignment: Alignment.centerLeft,
            child: Text('Showing the latest ${shown.length} of ${all.length}', style: LbText.muted(context, size: 12)),
          ),
        for (final row in shown) KeyedSubtree(key: ValueKey(row.key), child: row.widget),
        if (transcript.draft.isNotEmpty)
          Padding(padding: const EdgeInsets.only(bottom: 12), child: DraftBubble(text: transcript.draft, label: roleLabel(run.role)))
        else if (built.showWorking)
          const Padding(padding: EdgeInsets.only(bottom: 12), child: WorkingIndicator()),
        if (answer != null)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: Color.alphaBlend(c.primary.withValues(alpha: 0.08), c.card),
              borderRadius: BorderRadius.circular(LbRadius.md),
              border: Border.all(color: c.primary.withValues(alpha: 0.4)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('FINAL ANSWER', style: LbText.caption(context, color: c.primary).copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.9)),
                const SizedBox(height: 6),
                LbMarkdown(answer),
              ],
            ),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => AppNav.transcript(context, run.id, simRunId: simRunId),
            icon: const LbIcon(LbIcons.arrowRight01, size: 16),
            label: const Text('Open full transcript'),
          ),
        ),
      ],
    );
  }
}
