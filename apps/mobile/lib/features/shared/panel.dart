import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';

/// Titled card with an optional one-sentence [reading] that says what the
/// figures below show (the web `Panel`). Use for every chart or table block.
class Panel extends StatelessWidget {
  const Panel({super.key, required this.title, this.reading, this.actions, required this.child, this.padChild = true});

  final String title;

  /// One plain sentence stating the takeaway of the content.
  final String? reading;

  /// Trailing controls such as a range selector.
  final Widget? actions;
  final Widget child;

  /// Wrap [child] in the card padding; pass false for edge-to-edge lists.
  final bool padChild;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Semantics(
      container: true,
      label: title,
      child: LbCard(
        padding: EdgeInsets.zero,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(LbSpace.card, 12, LbSpace.card, 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SectionLabel(title),
                        if (reading != null) ...[
                          const SizedBox(height: 4),
                          Text(reading!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: c.foreground)),
                        ],
                      ],
                    ),
                  ),
                  if (actions != null) ...[const SizedBox(width: 8), actions!],
                ],
              ),
            ),
            if (padChild)
              Padding(padding: const EdgeInsets.fromLTRB(LbSpace.card, 0, LbSpace.card, LbSpace.card), child: child)
            else
              child,
          ],
        ),
      ),
    );
  }
}
