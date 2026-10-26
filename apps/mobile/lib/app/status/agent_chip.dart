import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/models/models.dart';

import 'status_text.dart';

/// Agent state with the next cycle time. The pill form sits in the header's
/// status row; [detailed] adds the schedule line and a Run now button for the
/// status sheet.
class AgentChip extends ConsumerWidget {
  const AgentChip({super.key, this.detailed = false});

  final bool detailed;

  static StatusTone toneOf(AgentState state) => switch (state) {
        AgentState.idle => StatusTone.neutral,
        AgentState.running => StatusTone.live,
        AgentState.error => StatusTone.loss,
        AgentState.needsLogin => StatusTone.warn,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agent = ref.watch(harnessProvider.select((s) => s.feed.status?.agent));
    if (agent == null) return const SkeletonBlock(width: 96, height: 24);
    final nowMs = ref.watch(clockProvider).millisecondsSinceEpoch;
    final next = agent.nextCycleAt;
    final label = agentLabel(agent.state);

    if (!detailed) {
      final pill = agent.state == AgentState.idle && next != null ? '$label \u00b7 next ${coarseCountdown(next - nowMs)}' : label;
      return StatusChip(pill, tone: toneOf(agent.state));
    }

    final busy = ref.watch(harnessProvider.select((s) => s.busy['cycle'] ?? false));
    final String subtitle;
    if (agent.state == AgentState.error && agent.lastError != null) {
      subtitle = agent.lastError!;
    } else if (next != null) {
      subtitle = 'Next ${etTime(next)} \u00b7 ${countdown(next - nowMs)}';
    } else {
      subtitle = 'No cycle scheduled';
    }
    final errorLine = agent.state == AgentState.error && agent.lastError != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Align(alignment: Alignment.centerLeft, child: StatusChip(label, tone: toneOf(agent.state))),
        const SizedBox(height: 6),
        Text(
          subtitle,
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
          style: errorLine ? LbText.muted(context).copyWith(color: context.lb.destructive) : LbText.muted(context),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: agent.state == AgentState.running || busy ? null : () => ref.read(harnessProvider.notifier).runCycle(),
          icon: const LbIcon(LbIcons.play, size: 16),
          label: const Text('Run now'),
        ),
      ],
    );
  }
}
