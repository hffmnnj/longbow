import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/domain/roles.dart';
import 'package:longbow/domain/steps.dart';
import 'package:longbow/domain/tool_meta.dart';
import 'package:longbow/models/models.dart';

import 'feed_icons.dart';
import 'trace.dart';

/// Reading width of a transcript column on wide screens.
const double kTranscriptMaxWidth = 720;

/// Divider between agent cycles: a hairline, the cycle kind and time, and (when
/// the cycle brief has a body) a tap target that opens it. Port of
/// CycleDivider.svelte.
class CycleDivider extends StatefulWidget {
  const CycleDivider({super.key, required this.message});

  final ChatMessage message;

  @override
  State<CycleDivider> createState() => _CycleDividerState();
}

class _CycleDividerState extends State<CycleDivider> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final text = widget.message.text.trim();
    final title = cycleLabel(widget.message.text);
    final lines = text.split('\n').length;
    final hasBody = text.contains('\n');
    final time = etTime(widget.message.at);
    final label = Text.rich(
      TextSpan(
        children: [
          TextSpan(text: title, style: Theme.of(context).textTheme.labelMedium!.copyWith(color: c.mutedForeground)),
          TextSpan(text: '  $time', style: LbText.number(context, size: 11.5, weight: FontWeight.w400, color: c.mutedForeground)),
        ],
      ),
      textAlign: TextAlign.center,
    );
    final pill = hasBody
        ? Semantics(
            button: true,
            expanded: _open,
            label: 'Cycle $title at $time',
            excludeSemantics: true,
            onTap: () => setState(() => _open = !_open),
            child: InkWell(
              borderRadius: BorderRadius.circular(LbRadius.xl),
              onTap: () => setState(() => _open = !_open),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: kMinTarget),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      AnimatedRotation(
                        turns: _open ? 0.25 : 0,
                        duration: LbMotion.duration(context, LbMotion.fast),
                        child: LbIcon(LbIcons.chevronRight, size: 14, color: c.mutedForeground),
                      ),
                      const SizedBox(width: 4),
                      Flexible(child: label),
                    ],
                  ),
                ),
              ),
            ),
          )
        : Semantics(
            container: true,
            label: 'Cycle $title at $time',
            excludeSemantics: true,
            child: Padding(padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 10), child: label),
          );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Divider(height: 1, color: c.border)),
            Flexible(flex: 6, child: pill),
            Expanded(child: Divider(height: 1, color: c.border)),
          ],
        ),
        AnimatedSize(
          duration: LbMotion.duration(context),
          curve: LbMotion.curve,
          alignment: Alignment.topCenter,
          child: _open && hasBody
              ? TraceDisclosure(
                  icon: LbIcons.file01,
                  title: 'Cycle input',
                  description: '$lines lines',
                  semanticLabel: 'Cycle input, $lines lines',
                  childBuilder: (_) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: OutputBlock(widget.message.text, maxHeight: 320),
                  ),
                )
              : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}

/// A message the owner sent: right-aligned bubble, selectable.
class UserBubble extends StatelessWidget {
  const UserBubble({super.key, required this.text, required this.at, this.caption, this.dim = false, this.footer});

  final String text;
  final int at;

  /// Replaces the "You · time" caption.
  final String? caption;
  final bool dim;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        ConstrainedBox(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.85),
          child: Opacity(
            opacity: dim ? 0.65 : 1,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: c.accent,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(LbRadius.lg),
                  topRight: Radius.circular(LbRadius.lg),
                  bottomLeft: Radius.circular(LbRadius.lg),
                  bottomRight: Radius.circular(LbRadius.sm),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                child: SelectableText(text, style: Theme.of(context).textTheme.bodyMedium),
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        footer ?? Text(caption ?? 'You \u00b7 ${etTime(at)}', style: LbText.muted(context, size: 11.5)),
      ],
    );
  }
}

/// A finished assistant message: label and time over markdown.
class AssistantMessage extends StatelessWidget {
  const AssistantMessage({super.key, required this.text, required this.at, this.label = 'Agent'});

  final String text;
  final int at;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('$label \u00b7 ${etTime(at)}', style: LbText.muted(context, size: 11.5)),
        const SizedBox(height: 4),
        LbMarkdown(text),
      ],
    );
  }
}

/// The streaming assistant reply: a "writing" label over markdown that grows
/// as deltas arrive. The only widget that rebuilds per delta.
class DraftBubble extends StatelessWidget {
  const DraftBubble({super.key, required this.text, this.label = 'Agent'});

  final String text;
  final String label;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Semantics(
      container: true,
      label: '$label is writing',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              PulseDot(color: c.live, size: 6),
              const SizedBox(width: 4),
              Text('$label \u00b7 writing', style: LbText.caption(context, color: c.primary)),
            ],
          ),
          const SizedBox(height: 4),
          LbMarkdown(text),
        ],
      ),
    );
  }
}

/// "Working" indicator shown while the agent runs between steps.
class WorkingIndicator extends StatelessWidget {
  const WorkingIndicator({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Semantics(
      container: true,
      liveRegion: true,
      label: 'Agent is working',
      child: Row(
        children: [
          PulseDot(color: c.live, size: 6),
          const SizedBox(width: 6),
          Text('Working', style: Theme.of(context).textTheme.labelMedium!.copyWith(color: c.primary)),
        ],
      ),
    );
  }
}

/// An optimistic message that is still sending or failed to send.
class OutboxBubble extends StatelessWidget {
  const OutboxBubble({super.key, required this.text, required this.at, required this.failed, required this.onRetry, required this.onDiscard});

  final String text;
  final int at;
  final bool failed;
  final VoidCallback onRetry;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return UserBubble(
      text: text,
      at: at,
      dim: true,
      footer: failed
          ? Wrap(
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 4,
              children: [
                Semantics(
                  liveRegion: true,
                  child: Text('Not sent', style: Theme.of(context).textTheme.labelMedium!.copyWith(color: c.loss)),
                ),
                TextButton(onPressed: onRetry, child: const Text('Retry')),
                TextButton(
                  onPressed: onDiscard,
                  style: TextButton.styleFrom(foregroundColor: c.mutedForeground),
                  child: const Text('Discard'),
                ),
              ],
            )
          : Text('Sending\u2026', style: LbText.muted(context, size: 11.5)),
    );
  }
}

SubagentRole? _roleFromWire(String? name) => switch (name) {
      'analyst' => SubagentRole.analyst,
      'bull' => SubagentRole.bull,
      'bear' => SubagentRole.bear,
      'risk_reviewer' => SubagentRole.riskReviewer,
      'researcher' => SubagentRole.researcher,
      _ => null,
    };

/// A long-running helper's report: a tinted card with a collapsed line that
/// opens the report body. Tinted so it never reads as the owner's words or the
/// lead agent's prose. Port of HelperReport.svelte.
class HelperReportCard extends StatelessWidget {
  const HelperReportCard({super.key, required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final report = helperReport(message);
    final role = _roleFromWire(report.role);
    final roleText = role != null ? roleLabel(role) : report.role;
    final icon = toolIconData(toolIcon('delegate', role: report.role));
    return Semantics(
      container: true,
      label: 'Helper report from ${report.name}',
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: c.muted,
          borderRadius: BorderRadius.circular(LbRadius.md),
          border: Border.all(color: c.border),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          child: TraceDisclosure(
            icon: icon,
            title: '${report.name} reported',
            description: '${roleText != null ? '$roleText \u00b7 ' : ''}${etTime(message.at)}',
            semanticLabel: '${report.name} reported${roleText != null ? ', $roleText' : ''}',
            childBuilder: (_) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: LbMarkdown(report.body),
            ),
          ),
        ),
      ),
    );
  }
}
