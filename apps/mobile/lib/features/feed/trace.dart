import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';

/// Status of a trace line: a live pulse while running, a red glyph on error.
enum TraceStatus { running, error }

/// One quiet line of a tool trace: icon, sentence title, muted description,
/// optional status. Tappable rows are 48dp tall and announce expanded state.
/// Text is always plain (never markdown), it comes from the model.
class TraceRow extends StatelessWidget {
  const TraceRow({
    super.key,
    required this.icon,
    required this.title,
    this.description,
    this.status,
    this.onTap,
    this.expanded,
    this.semanticLabel,
    this.trailing,
    this.maxTitleLines = 2,
  });

  final IconData icon;
  final String title;
  final String? description;
  final TraceStatus? status;
  final VoidCallback? onTap;

  /// Non-null renders a chevron and the expanded semantics.
  final bool? expanded;
  final String? semanticLabel;
  final Widget? trailing;
  final int maxTitleLines;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final iconColor = status == TraceStatus.error ? c.loss : c.mutedForeground;
    final lead = status == TraceStatus.running
        ? SizedBox.square(dimension: 20, child: Center(child: PulseDot(color: c.live, size: 6)))
        : LbIcon(status == TraceStatus.error ? LbIcons.alertCircle : icon, size: 18, color: iconColor);
    final base = Theme.of(context).textTheme.bodyMedium!.copyWith(fontSize: 13.5, height: 1.35);
    final text = Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: title,
            style: base.copyWith(
              fontWeight: FontWeight.w500,
              color: status == TraceStatus.error ? c.loss : c.foreground,
            ),
          ),
          if (description != null && description!.isNotEmpty)
            TextSpan(
              text: '  $description',
              style: LbText.number(context, size: 12, weight: FontWeight.w400, color: c.mutedForeground),
            ),
        ],
      ),
      maxLines: maxTitleLines,
      overflow: TextOverflow.ellipsis,
    );
    final row = ConstrainedBox(
      constraints: BoxConstraints(minHeight: onTap != null ? kMinTarget : 32),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Padding(padding: const EdgeInsets.only(left: 2), child: lead),
            const SizedBox(width: 10),
            Expanded(child: text),
            if (trailing != null) ...[const SizedBox(width: 8), trailing!],
            if (expanded != null) ...[
              const SizedBox(width: 6),
              AnimatedRotation(
                turns: expanded! ? 0.5 : 0,
                duration: LbMotion.duration(context, LbMotion.fast),
                curve: LbMotion.curve,
                child: LbIcon(LbIcons.chevronDown, size: 18, color: c.mutedForeground),
              ),
              const SizedBox(width: 2),
            ],
          ],
        ),
      ),
    );
    if (onTap == null) {
      return Semantics(label: semanticLabel, container: true, child: row);
    }
    return Semantics(
      button: true,
      expanded: expanded,
      label: semanticLabel,
      onTap: onTap,
      excludeSemantics: semanticLabel != null,
      child: InkWell(borderRadius: BorderRadius.circular(LbRadius.md), onTap: onTap, child: row),
    );
  }
}

/// A trace line that opens in place. Content is built only while open.
/// [defaultOpen] applies until the user taps; after that the user wins.
class TraceDisclosure extends StatefulWidget {
  const TraceDisclosure({
    super.key,
    required this.icon,
    required this.title,
    required this.childBuilder,
    this.description,
    this.status,
    this.semanticLabel,
    this.defaultOpen = false,
    this.trailing,
    this.onChanged,
  });

  final IconData icon;
  final String title;
  final String? description;
  final TraceStatus? status;
  final String? semanticLabel;
  final bool defaultOpen;
  final Widget? trailing;
  final WidgetBuilder childBuilder;

  /// Called with the new open state after the user taps.
  final ValueChanged<bool>? onChanged;

  @override
  State<TraceDisclosure> createState() => _TraceDisclosureState();
}

class _TraceDisclosureState extends State<TraceDisclosure> {
  bool? _user;

  bool get _open => _user ?? widget.defaultOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final open = _open;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TraceRow(
          icon: widget.icon,
          title: widget.title,
          description: widget.description,
          status: widget.status,
          semanticLabel: widget.semanticLabel,
          trailing: widget.trailing,
          expanded: open,
          onTap: () {
            setState(() => _user = !open);
            widget.onChanged?.call(!open);
          },
        ),
        AnimatedSize(
          duration: LbMotion.duration(context),
          curve: LbMotion.curve,
          alignment: Alignment.topCenter,
          child: open
              ? Container(
                  margin: const EdgeInsets.only(left: 11, bottom: 4),
                  padding: const EdgeInsets.only(left: 12, top: 2, bottom: 2),
                  decoration: BoxDecoration(border: Border(left: BorderSide(color: c.border))),
                  child: Builder(builder: widget.childBuilder),
                )
              : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}

/// Stacks trace lines with a hairline of air between them.
class TraceColumn extends StatelessWidget {
  const TraceColumn({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: children,
      );
}

/// Wrapped, selectable mono text for tool output; red when [error]. Capped in
/// height so one huge result never owns the transcript.
class OutputBlock extends StatelessWidget {
  const OutputBlock(this.text, {super.key, this.error = false, this.maxHeight = 224});

  final String text;
  final bool error;
  final double maxHeight;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Container(
      constraints: BoxConstraints(maxHeight: maxHeight),
      decoration: BoxDecoration(color: c.muted, borderRadius: BorderRadius.circular(LbRadius.md), border: Border.all(color: c.border)),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(12),
        child: SelectableText(
          text,
          style: LbText.number(context, size: 12.5, weight: FontWeight.w400, color: error ? c.loss : c.foreground).copyWith(height: 1.5),
        ),
      ),
    );
  }
}
