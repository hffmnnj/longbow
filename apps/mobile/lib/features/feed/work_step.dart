import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/steps.dart';
import 'package:longbow/domain/tool_meta.dart';
import 'package:longbow/models/models.dart';

import 'trace.dart';
import 'tool_calls.dart';

/// A Code Mode script and its result as one collapsible "Worked for 4s · 7
/// calls" line (port of WorkStep.svelte). The running step opens by itself and
/// streams its nested calls from [liveCalls]; a finished step collapses unless
/// the user opened it.
class WorkStep extends ConsumerWidget {
  const WorkStep({
    super.key,
    required this.code,
    this.result,
    this.live = false,
    this.liveCalls = const [],
    this.subagents = const [],
    this.simRunId,
  });

  final ChatMessage code;
  final ChatMessage? result;

  /// True while this is the running script; nested calls then come from [liveCalls].
  final bool live;
  final List<ToolCallSummary> liveCalls;
  final List<SubagentRun> subagents;
  final String? simRunId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Only the running step ticks with the shared clock.
    final now = live ? ref.watch(clockProvider).millisecondsSinceEpoch : DateTime.now().millisecondsSinceEpoch;
    final calls = result?.calls ?? (live ? liveCalls : const <ToolCallSummary>[]);
    final groups = groupConsecutive<ToolCallSummary>(calls, (c) => c.name);
    final failed = calls.where((c) => c.isError == true).length;
    final runs = matchRuns(calls, subagents, code.at, (result?.at ?? now) + 1000);
    final runByCall = Map<ToolCallSummary, SubagentRun?>.identity();
    for (var i = 0; i < calls.length; i++) {
      runByCall[calls[i]] = runs[i];
    }

    int? elapsed;
    final r = result;
    if (r != null) {
      final wall = r.at - code.at;
      elapsed = wall > 0 ? wall : calls.fold<int>(0, (a, c) => (c.durationMs ?? 0) > a ? c.durationMs! : a);
    } else if (live) {
      elapsed = (now - code.at).clamp(0, 1 << 40);
    }

    final countLabel = '${calls.length} ${calls.length == 1 ? 'call' : 'calls'}';
    final String title;
    if (live) {
      if (calls.isEmpty) {
        title = 'Working\u2026';
      } else {
        title = 'Working${elapsed != null ? ' for ${durationShort(elapsed)}' : ''} \u00b7 $countLabel';
      }
    } else if (r != null) {
      title = 'Worked${elapsed != null ? ' for ${durationShort(elapsed)}' : ''} \u00b7 $countLabel${failed > 0 ? ' \u00b7 $failed failed' : ''}';
    } else {
      title = 'Script';
    }
    final status = live
        ? TraceStatus.running
        : failed > 0
            ? TraceStatus.error
            : null;
    final label = status == null
        ? '$title, $countLabel'
        : '$title, ${status == TraceStatus.running ? 'running' : 'failed'}';
    final script = code.code;
    final scriptLines = script == null || script.isEmpty ? 0 : script.split('\n').length;

    return TraceDisclosure(
      icon: LbIcons.code,
      title: title,
      description: failed > 0 && !live ? '$failed failed' : null,
      status: status,
      semanticLabel: label,
      defaultOpen: live,
      childBuilder: (context) => TraceColumn(
        children: [
          for (var gi = 0; gi < groups.length; gi++)
            if (groups[gi].items.length > 1)
              ToolCallGroup(
                key: ValueKey('${groups[gi].name}-$gi'),
                name: groups[gi].name,
                items: groups[gi].items,
                getRun: (item) => item is ToolCallSummary ? runByCall[item] : null,
                simRunId: simRunId,
              )
            else
              ToolCallLine(
                key: ValueKey('${groups[gi].name}-$gi'),
                call: groups[gi].items.first,
                run: runByCall[groups[gi].items.first],
                simRunId: simRunId,
              ),
          if (scriptLines > 0)
            TraceDisclosure(
              icon: LbIcons.code,
              title: 'Script',
              description: '$scriptLines ${scriptLines == 1 ? 'line' : 'lines'}',
              semanticLabel: 'Script, $scriptLines lines',
              childBuilder: (_) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: CodeBlock(script!, maxHeight: 288),
              ),
            ),
          if (r != null && r.text.isNotEmpty)
            TraceDisclosure(
              icon: LbIcons.command,
              title: 'Output',
              status: r.isError == true ? TraceStatus.error : null,
              semanticLabel: r.isError == true ? 'Output, failed' : 'Output',
              childBuilder: (_) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: OutputBlock(r.text, error: r.isError == true),
              ),
            ),
        ],
      ),
    );
  }
}
