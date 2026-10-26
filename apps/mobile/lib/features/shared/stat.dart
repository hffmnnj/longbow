import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';

/// Label, one prominent figure, optional sub-line (the web `Stat`).
/// Wrap several in a [Wrap] or grid; it never fixes a height.
class Stat extends StatelessWidget {
  const Stat({super.key, required this.label, this.value, this.sub, this.tone = Tone.flat, this.child});

  final String label;

  /// Shown as tabular text; null renders an em dash.
  final String? value;
  final String? sub;
  final Tone tone;

  /// Replaces [value] with a custom widget (for example a [Pnl]).
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final color = switch (tone) {
      Tone.gain => c.gain,
      Tone.loss => c.loss,
      Tone.flat => c.foreground,
    };
    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          SectionLabel(label),
          const SizedBox(height: 2),
          child ?? Text(value ?? '\u2014', maxLines: 1, overflow: TextOverflow.ellipsis, style: LbText.number(context, size: 17, weight: FontWeight.w600, color: color)),
          if (sub != null) Text(sub!, maxLines: 1, overflow: TextOverflow.ellipsis, style: LbText.number(context, size: 11.5, color: c.mutedForeground)),
        ],
      ),
    );
  }
}
