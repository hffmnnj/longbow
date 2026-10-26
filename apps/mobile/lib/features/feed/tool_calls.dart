import 'package:flutter/material.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/domain/roles.dart';
import 'package:longbow/domain/steps.dart';
import 'package:longbow/domain/tool_meta.dart';
import 'package:longbow/models/models.dart';

import 'feed_icons.dart';
import 'risk_checks.dart';
import 'trace.dart';

/// One tool call as a trace line (port of TraceCall.svelte): family icon,
/// sentence title, duration or first line as description, running or error
/// status. Expands into the linked subagent, risk checks, the URLs it touched
/// and the full text when there is more to show.
///
/// [call] is a transcript [ChatMessage] or a script's nested
/// [ToolCallSummary]. Every string here is model output and renders as plain
/// text.
class ToolCallLine extends StatelessWidget {
  const ToolCallLine({super.key, required this.call, this.run, this.order, this.simRunId});

  final AnyCall call;

  /// Matched subagent run for a `delegate` call.
  final SubagentRun? run;

  /// Matched order for a `submit_order` message.
  final OrderRecord? order;

  /// Simulation run that owns the transcript, so transcript pages route back to it.
  final String? simRunId;

  @override
  Widget build(BuildContext context) {
    final name = callName(call);
    final message = call is ChatMessage ? call as ChatMessage : null;
    final summaryCall = call is ToolCallSummary ? call as ToolCallSummary : null;
    final text = message?.text;
    final summary = callSummary(call) ?? text;
    final isError = message?.isError ?? summaryCall?.isError;
    final failed = isError == true || submitOrderFailed(order);
    final running = summaryCall != null && isRunning(summaryCall);
    final status = failed
        ? TraceStatus.error
        : running
            ? TraceStatus.running
            : null;
    final icon = toolIconData(toolIcon(name, summary: callSummary(call), role: message?.agentRole));
    final title = toolTitle(name, summary);
    final urls = extractUrls(summary);
    final duration = summaryCall?.durationMs != null ? durationShort(summaryCall!.durationMs!) : null;
    final description = duration ?? firstLine(text);

    ({String id, String label})? target;
    if (run != null) {
      target = (id: run!.id, label: roleLabel(run!.role));
    } else if (message?.childConversationId != null) {
      target = (id: message!.childConversationId!, label: message.agentRole ?? 'agent');
    }

    String? detailText;
    if (text != null && text.trim().isNotEmpty) {
      final shown = firstLine(text);
      if (shown != null && (text.trim().length > shown.length || text.contains('\n'))) detailText = text;
    }

    final expandable = order != null || target != null || urls.isNotEmpty || detailText != null;
    final label = status == null ? null : '$title, ${status == TraceStatus.error ? 'failed' : 'running'}';
    if (!expandable) {
      return TraceRow(icon: icon, title: title, description: description, status: status, semanticLabel: label);
    }
    return TraceDisclosure(
      icon: icon,
      title: title,
      description: description,
      status: status,
      semanticLabel: label,
      childBuilder: (context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (target != null)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => AppNav.transcript(context, target!.id, simRunId: simRunId),
                icon: const LbIcon(LbIcons.arrowRight01, size: 16),
                label: Text('Open ${target.label} transcript'),
              ),
            ),
          if (order != null) RiskChecks(verdict: order!.verdict),
          if (urls.isNotEmpty) _Sources(urls),
          if (detailText != null)
            Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 4),
              child: OutputBlock(detailText, error: failed, maxHeight: 288),
            ),
        ],
      ),
    );
  }
}

class _Sources extends StatelessWidget {
  const _Sources(this.urls);

  final List<String> urls;

  @override
  Widget build(BuildContext context) {
    final title = 'Used ${urls.length} ${urls.length == 1 ? 'source' : 'sources'}';
    return TraceDisclosure(
      icon: LbIcons.link04,
      title: title,
      semanticLabel: title,
      childBuilder: (context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final url in urls)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LbIcon(LbIcons.link04, size: 16, color: context.lb.mutedForeground),
                  const SizedBox(width: 8),
                  Expanded(
                    child: SelectableText(
                      sourceMeta(url).label,
                      style: LbText.number(context, size: 12, weight: FontWeight.w400, color: context.lb.mutedForeground),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A run of the same tool as one collapsible line ("Market indicators ×11"),
/// expanding into one line per call (port of TraceCallGroup.svelte).
class ToolCallGroup extends StatelessWidget {
  const ToolCallGroup({super.key, required this.name, required this.items, this.getRun, this.getOrder, this.simRunId});

  final String name;
  final List<AnyCall> items;
  final SubagentRun? Function(AnyCall item)? getRun;
  final OrderRecord? Function(AnyCall item)? getOrder;
  final String? simRunId;

  @override
  Widget build(BuildContext context) {
    final failed = items.where(_isError).length;
    final running = items.where((c) => c is ToolCallSummary && isRunning(c)).length;
    final status = failed > 0
        ? TraceStatus.error
        : running > 0
            ? TraceStatus.running
            : null;
    final totalMs = items.fold<int>(0, (a, c) => a + (c is ToolCallSummary ? (c.durationMs ?? 0) : 0));
    final parts = [
      if (totalMs > 0) durationShort(totalMs),
      '${items.length} ${items.length == 1 ? 'call' : 'calls'}',
    ];
    final title = '${humanize(name)} \u00d7${items.length}';
    final label = '$title, ${parts.join(', ')}${status == null ? '' : status == TraceStatus.error ? ', failed' : ', running'}';
    return TraceDisclosure(
      icon: toolIconData(toolIcon(name)),
      title: title,
      description: parts.join(' \u00b7 '),
      status: status,
      semanticLabel: label,
      childBuilder: (context) => TraceColumn(
        children: [
          for (var i = 0; i < items.length; i++)
            ToolCallLine(
              key: ValueKey('$name-$i'),
              call: items[i],
              run: getRun?.call(items[i]),
              order: getOrder?.call(items[i]),
              simRunId: simRunId,
            ),
        ],
      ),
    );
  }

  static bool _isError(AnyCall c) => c is ChatMessage ? c.isError == true : (c as ToolCallSummary).isError == true;
}

/// Consecutive tool messages as one trace (port of ToolTrace.svelte).
class ToolTrace extends StatelessWidget {
  const ToolTrace({super.key, required this.messages, required this.orders, this.simRunId});

  final List<ChatMessage> messages;
  final List<OrderRecord> orders;
  final String? simRunId;

  OrderRecord? _orderFor(AnyCall item) =>
      item is ChatMessage && item.toolName == 'submit_order' ? matchSubmitOrder(item.text, orders) : null;

  @override
  Widget build(BuildContext context) {
    final groups = groupConsecutive<ChatMessage>(messages, (m) => m.toolName ?? 'tool');
    return TraceColumn(
      children: [
        for (final group in groups)
          if (group.items.length > 1)
            ToolCallGroup(
              key: ValueKey(group.items.first.id),
              name: group.name,
              items: group.items,
              getOrder: _orderFor,
              simRunId: simRunId,
            )
          else
            ToolCallLine(
              key: ValueKey(group.items.first.id),
              call: group.items.first,
              order: _orderFor(group.items.first),
              simRunId: simRunId,
            ),
      ],
    );
  }
}
