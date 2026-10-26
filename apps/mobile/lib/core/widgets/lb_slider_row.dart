import 'package:flutter/material.dart';

import '../haptics.dart';
import '../theme/theme.dart';

/// A labelled slider with the current value shown on the right in mono.
/// [format] renders the value ("25%"). Fires a selection haptic per division.
class LbSliderRow extends StatelessWidget {
  const LbSliderRow({
    super.key,
    required this.label,
    required this.value,
    required this.min,
    required this.max,
    required this.onChanged,
    this.divisions,
    this.format,
  });

  final String label;
  final double value;
  final double min;
  final double max;
  final int? divisions;
  final String Function(double)? format;
  final ValueChanged<double>? onChanged;

  @override
  Widget build(BuildContext context) {
    final shown = (format ?? (v) => v.toStringAsFixed(divisions == null ? 1 : 0))(value);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text(label, style: Theme.of(context).textTheme.bodyMedium)),
            const SizedBox(width: 12),
            Text(shown, style: LbText.number(context)),
          ],
        ),
        Slider(
          value: value.clamp(min, max),
          min: min,
          max: max,
          divisions: divisions,
          label: shown,
          semanticFormatterCallback: (v) => '$label ${(format ?? (x) => x.toString())(v)}',
          onChanged: onChanged == null
              ? null
              : (v) {
                  if (divisions != null && v != value) Haptics.selection();
                  onChanged!(v);
                },
        ),
      ],
    );
  }
}
