import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// Flat bordered surface (card color, 1px border, 14dp radius). With [onTap]
/// it becomes a 48dp-minimum tappable button with an ink response.
class LbCard extends StatelessWidget {
  const LbCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(LbSpace.card),
    this.onTap,
    this.color,
    this.borderColor,
    this.semanticLabel,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  /// Overrides the card color (e.g. `context.lb.labBg`).
  final Color? color;
  final Color? borderColor;

  /// Spoken label when [onTap] is set and the content is not self-describing.
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final radius = BorderRadius.circular(LbRadius.lg);
    final content = Padding(padding: padding, child: child);
    return Material(
      color: color ?? c.card,
      shape: RoundedRectangleBorder(borderRadius: radius, side: BorderSide(color: borderColor ?? c.border)),
      clipBehavior: Clip.antiAlias,
      child: onTap == null
          ? content
          : Semantics(
              button: true,
              label: semanticLabel,
              child: InkWell(onTap: onTap, child: ConstrainedBox(constraints: const BoxConstraints(minHeight: kMinTarget), child: content)),
            ),
    );
  }
}

/// A titled [LbCard]: title row (with optional [trailing] action) over a
/// [child]. Use as the standard grouping on every screen.
class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.title,
    required this.child,
    this.trailing,
    this.padding = const EdgeInsets.all(LbSpace.card),
    this.onTap,
  });

  final String title;
  final Widget child;

  /// Small action or status on the right of the title (a TextButton, chip...).
  final Widget? trailing;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return LbCard(
      padding: padding,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(title, style: Theme.of(context).textTheme.titleMedium),
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 8), Flexible(child: trailing!)],
            ],
          ),
          const SizedBox(height: LbSpace.gap),
          child,
        ],
      ),
    );
  }
}
