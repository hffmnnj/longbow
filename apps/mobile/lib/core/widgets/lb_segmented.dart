import 'package:flutter/material.dart';

import '../haptics.dart';

/// One option of an [LbSegmented].
class LbSegment<T> {
  const LbSegment(this.value, this.label, {this.icon});
  final T value;
  final String label;
  final IconData? icon;
}

/// Single-select segmented control for ranges and tabs. Scrolls horizontally
/// if the options do not fit (large text). Fires a selection haptic on change.
class LbSegmented<T> extends StatelessWidget {
  const LbSegmented({super.key, required this.segments, required this.selected, required this.onChanged, this.semanticLabel});

  final List<LbSegment<T>> segments;
  final T selected;
  final ValueChanged<T> onChanged;

  /// Group name for screen readers ("Chart range").
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticLabel,
      container: true,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SegmentedButton<T>(
          showSelectedIcon: false,
          segments: [
            for (final s in segments)
              ButtonSegment<T>(value: s.value, label: Text(s.label), icon: s.icon == null ? null : Icon(s.icon, size: 18)),
          ],
          selected: {selected},
          onSelectionChanged: (set) {
            final v = set.first;
            if (v == selected) return;
            Haptics.selection();
            onChanged(v);
          },
        ),
      ),
    );
  }
}
