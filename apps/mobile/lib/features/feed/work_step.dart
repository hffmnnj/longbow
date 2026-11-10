import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/steps.dart';
import 'package:longbow/domain/tool_meta.dart';
import 'package:longbow/models/models.dart';

import 'trace.dart';
import 'tool_calls.dart';

/// A Code Mode script and its result as one chronological activity group.
/// The header leads with the outcome ("Using tools", "Tools completed",
/// "Tool run failed"), the real call count and the generation-to-result
/// elapsed time; Script and Result live together in a collapsed Details
/// section with Script/Result tabs instead of trailing peer rows. A result
/// with [ChatMessage.isError] marks the group failed even when no nested
/// calls were recorded. The running step opens by itself and streams its
/// nested calls from [liveCalls]; a finished step stays compact unless the
/// user opened it, and opening Details never reopens a closed group.
class WorkStep extends ConsumerStatefulWidget {
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
  ConsumerState<WorkStep> createState() => _WorkStepState();
}

class _WorkStepState extends ConsumerState<WorkStep> {
  late String _tab;

  @override
  void initState() {
    super.initState();
    _tab = (widget.code.code?.isNotEmpty ?? false) ? 'script' : 'result';
  }

  @override
  Widget build(BuildContext context) {
    // Only the running step ticks with the shared clock.
    final now = widget.live ? ref.watch(clockProvider).millisecondsSinceEpoch : DateTime.now().millisecondsSinceEpoch;
    final calls = widget.result?.calls ?? (widget.live ? widget.liveCalls : const <ToolCallSummary>[]);
    final groups = groupConsecutive<ToolCallSummary>(calls, (c) => c.name);
    final failedCalls = calls.where((c) => c.isError == true).length;
    final resultFailed = widget.result?.isError == true;
    final failed = isStepFailed(calls, widget.result);
    final step = stepStatus(widget.live, calls, widget.result);
    final status = switch (step) {
      StepStatus.running => TraceStatus.running,
      StepStatus.error => TraceStatus.error,
      StepStatus.none => null,
    };
    final runs = matchRuns(calls, widget.subagents, widget.code.at, (widget.result?.at ?? now) + 1000);
    final runByCall = Map<ToolCallSummary, SubagentRun?>.identity();
    for (var i = 0; i < calls.length; i++) {
      runByCall[calls[i]] = runs[i];
    }

    int? elapsed;
    final r = widget.result;
    if (r != null) {
      final wall = r.at - widget.code.at;
      elapsed = wall > 0 ? wall : calls.fold<int>(0, (a, c) => (c.durationMs ?? 0) > a ? c.durationMs! : a);
    } else if (widget.live) {
      elapsed = (now - widget.code.at).clamp(0, 1 << 40);
    }

    final countLabel = '${calls.length} ${calls.length == 1 ? 'call' : 'calls'}';
    final elapsedLabel = elapsed != null ? ' \u00b7 ${durationShort(elapsed)} elapsed' : '';
    final metadata = '$countLabel$elapsedLabel';
    // Outcome once in the title; count/elapsed/failure live in the wrappable
    // secondary slot so narrow widths reflow instead of truncating mid-fact.
    final String title;
    if (widget.live) {
      title = calls.isEmpty ? 'Using tools\u2026' : 'Using tools';
    } else if (r != null) {
      title = failed ? 'Tool run failed' : 'Tools completed';
    } else {
      title = 'Script';
    }
    // The newest still-running nested call; its title replaces a vague duplicate "Working".
    ToolCallSummary? runningCall;
    if (widget.live && calls.isNotEmpty) {
      for (var i = calls.length - 1; i >= 0; i--) {
        if (isRunning(calls[i])) {
          runningCall = calls[i];
          break;
        }
      }
      runningCall ??= calls.last;
    }
    final runningTitle = runningCall == null ? null : toolTitle(runningCall.name, runningCall.summary);
    final String? description;
    if (widget.live) {
      description = runningTitle != null ? '$runningTitle \u00b7 $metadata' : 'Starting\u2026';
    } else if (r == null) {
      description = null;
    } else if (failed) {
      description = failedCalls > 0 ? '$failedCalls failed \u00b7 $metadata' : metadata;
    } else {
      description = metadata;
    }
    final label = widget.live
        ? '$title \u00b7 $metadata${runningTitle != null ? ' \u00b7 $runningTitle' : ''}, running'
        : failed && failedCalls > 0
            ? '$title \u00b7 $failedCalls failed \u00b7 $metadata'
            : '$title \u00b7 $metadata';
    final script = widget.code.code;
    final scriptLines = script == null || script.isEmpty ? 0 : script.split('\n').length;
    final detailsSummary = scriptLines > 0
        ? (r == null
            ? (widget.live ? 'Script \u00b7 running' : 'Script \u00b7 no result yet')
            : 'Script \u00b7 ${resultFailed ? 'output failed' : 'output'}')
        : (r == null
            ? 'No script \u00b7 no result yet'
            : 'No script \u00b7 ${resultFailed ? 'output failed' : 'output'}');

    return TraceDisclosure(
      icon: LbIcons.code,
      title: title,
      description: description,
      status: status,
      semanticLabel: label,
      defaultOpen: widget.live,
      childBuilder: (context) => TraceColumn(
        children: [
          if (groups.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Text(
                widget.live
                    ? 'Starting\u2026 calls appear here as they run.'
                    : r != null
                        ? 'No tool calls recorded.'
                        : 'Waiting for the script result.',
                style: LbText.muted(context, size: 12),
              ),
            ),
          for (var gi = 0; gi < groups.length; gi++)
            if (groups[gi].items.length > 1)
              ToolCallGroup(
                key: ValueKey('${groups[gi].name}-$gi'),
                name: groups[gi].name,
                items: groups[gi].items,
                getRun: (item) => item is ToolCallSummary ? runByCall[item] : null,
                simRunId: widget.simRunId,
              )
            else
              ToolCallLine(
                key: ValueKey('${groups[gi].name}-$gi'),
                call: groups[gi].items.first,
                run: runByCall[groups[gi].items.first],
                simRunId: widget.simRunId,
              ),
          TraceDisclosure(
            icon: LbIcons.file01,
            title: 'Details',
            description: detailsSummary,
            status: resultFailed ? TraceStatus.error : null,
            semanticLabel: 'Details: script and result, $detailsSummary',
            childBuilder: (context) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                LbSegmented<String>(
                  semanticLabel: 'Details section',
                  selected: _tab,
                  onChanged: (v) => setState(() => _tab = v),
                  segments: const [
                    LbSegment('script', 'Script'),
                    LbSegment('result', 'Result'),
                  ],
                ),
                const SizedBox(height: 8),
                if (_tab == 'script')
                  scriptLines > 0
                      ? CodeBlock(script!, maxHeight: 288)
                      : Text('No script recorded.', style: LbText.muted(context, size: 12)),
                if (_tab == 'result')
                  r != null && r.text.isNotEmpty
                      ? OutputBlock(r.text, error: resultFailed)
                      : Text(
                          widget.live
                              ? 'Running\u2026 the result appears here when the script finishes.'
                              : r != null
                                  ? (resultFailed
                                      ? 'The script failed with no output text.'
                                      : 'The script finished with no output text.')
                                  : 'No result yet.',
                          style: resultFailed && !widget.live && r != null
                              ? Theme.of(context).textTheme.bodySmall!.copyWith(color: context.lb.loss)
                              : LbText.muted(context, size: 12),
                        ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
