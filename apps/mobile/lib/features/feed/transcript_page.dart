import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/roles.dart';
import 'package:longbow/models/models.dart';

import 'feed_icons.dart';
import 'transcript_view.dart';

/// One subagent conversation as a full-screen page: role and task header,
/// status, and its transcript (no composer). Reads the live account, or one
/// simulation run when [simRunId] is set.
class TranscriptPage extends ConsumerStatefulWidget {
  const TranscriptPage({super.key, required this.conversationId, this.simRunId});

  final String conversationId;

  /// Set when the conversation belongs to a simulation run.
  final String? simRunId;

  @override
  ConsumerState<TranscriptPage> createState() => _TranscriptPageState();
}

class _TranscriptPageState extends ConsumerState<TranscriptPage> {
  bool _loading = true;

  // Keeps the message list identity stable across deltas so rows are not rebuilt.
  List<ChatMessage>? _source;
  String? _answer;
  List<ChatMessage> _shown = const [];

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() => _loading = true);
    await _loader()(widget.conversationId);
    if (mounted) setState(() => _loading = false);
  }

  Future<void> Function(String) _loader() {
    final sim = widget.simRunId;
    if (sim != null) {
      final store = ref.read(simProvider.notifier);
      return (id) => store.loadTranscript(sim, id);
    }
    return ref.read(harnessProvider.notifier).loadTranscript;
  }

  List<ChatMessage> _messagesWithoutAnswer(List<ChatMessage> messages, String? answer) {
    if (answer == null) return messages;
    if (!identical(_source, messages) || _answer != answer) {
      _source = messages;
      _answer = answer;
      _shown = messages.where((m) => !(m.role == ChatRole.assistant && m.text == answer)).toList();
    }
    return _shown;
  }

  @override
  Widget build(BuildContext context) {
    final sim = widget.simRunId;
    final feed = sim != null ? ref.watch(simFeedProvider(sim)) : ref.watch(harnessProvider.select((s) => s.feed));
    SubagentRun? run;
    for (final r in feed.subagents) {
      if (r.id == widget.conversationId) run = r;
    }
    final transcript = feed.transcripts[widget.conversationId];
    final c = context.lb;
    final label = run != null ? roleLabel(run.role) : 'Agent';
    final title = run?.symbol != null ? '$label on ${run!.symbol}' : label;

    final Widget body;
    if (transcript == null) {
      body = _loading
          ? const Padding(
              padding: EdgeInsets.all(LbSpace.screen),
              child: SkeletonLines(lines: 5, lineHeight: 14),
            )
          : ErrorState(
              title: 'Transcript unavailable',
              message: 'This conversation could not be loaded.',
              onRetry: _load,
            );
    } else {
      final answer = run?.answer;
      body = FeedTranscriptView(
        feed: FeedState(
          messages: _messagesWithoutAnswer(transcript.messages, answer),
          draft: transcript.draft,
          calls: transcript.calls,
          orders: feed.orders,
          subagents: feed.subagents,
        ),
        loadTranscript: _loader(),
        simRunId: sim,
        running: run?.status == SubagentStatus.running,
        agentLabel: label,
        showLane: false,
        sidePadding: 0,
        emptyTitle: 'No messages yet',
        emptyMessage: 'This agent has not written anything.',
        footer: answer == null ? null : _FinalAnswer(answer: answer),
      );
    }

    return LbPageScaffold(
      title: title,
      largeTitle: false,
      leading: IconButton(
        tooltip: 'Back',
        icon: const LbIcon(LbIcons.back),
        onPressed: () => Navigator.of(context).maybePop(),
      ),
      slivers: [
        if (run != null) SliverToBoxAdapter(child: _Header(run: run)),
        SliverFillRemaining(
          hasScrollBody: true,
          child: Padding(
            padding: const EdgeInsets.only(top: LbSpace.gap),
            child: DecoratedBox(
              decoration: BoxDecoration(border: Border(top: BorderSide(color: c.border))),
              child: body,
            ),
          ),
        ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.run});

  final SubagentRun run;

  @override
  Widget build(BuildContext context) {
    final tone = switch (run.status) {
      SubagentStatus.running => StatusTone.live,
      SubagentStatus.done => StatusTone.gain,
      SubagentStatus.failed => StatusTone.loss,
    };
    final statusLabel = switch (run.status) {
      SubagentStatus.running => 'Running',
      SubagentStatus.done => 'Done',
      SubagentStatus.failed => 'Failed',
    };
    final end = run.endedAt ?? DateTime.now().millisecondsSinceEpoch;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 10,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            LbIcon(roleIconData(roleIcon(run.role)), size: 20, color: context.lb.mutedForeground),
            StatusChip(statusLabel, tone: tone),
            Text(
              '${etStamp(run.startedAt)} \u00b7 ${durationShort((end - run.startedAt).clamp(0, 1 << 40))}',
              style: LbText.number(context, size: 12, weight: FontWeight.w400, color: context.lb.mutedForeground),
            ),
          ],
        ),
        const SizedBox(height: 8),
        SelectableText(run.task, maxLines: 6, style: LbText.muted(context, size: 14)),
      ],
    );
  }
}

class _FinalAnswer extends StatelessWidget {
  const _FinalAnswer({required this.answer});

  final String answer;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Color.alphaBlend(c.primary.withValues(alpha: 0.08), c.card),
        borderRadius: BorderRadius.circular(LbRadius.md),
        border: Border.all(color: c.primary.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            header: true,
            child: Text('FINAL ANSWER', style: LbText.caption(context, color: c.primary).copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.9)),
          ),
          const SizedBox(height: 6),
          LbMarkdown(answer),
        ],
      ),
    );
  }
}
