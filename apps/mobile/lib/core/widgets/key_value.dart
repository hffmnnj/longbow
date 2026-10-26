import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// A label on the left and a value on the right. Both wrap at large text
/// scales. Give [value] for plain text (rendered in tabular mono unless
/// [mono] is false) or [valueWidget] for a Pnl, chip, etc.
class KeyValueRow extends StatelessWidget {
  const KeyValueRow(this.label, {super.key, this.value, this.valueWidget, this.mono = true, this.valueColor})
      : assert(value != null || valueWidget != null, 'KeyValueRow needs a value or a valueWidget');

  final String label;
  final String? value;
  final Widget? valueWidget;
  final bool mono;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final valueStyle = mono
        ? LbText.number(context, color: valueColor)
        : Theme.of(context).textTheme.bodyMedium!.copyWith(color: valueColor);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(flex: 4, child: Text(label, style: LbText.muted(context))),
          const SizedBox(width: 12),
          Expanded(
            flex: 5,
            child: Align(
              alignment: Alignment.centerRight,
              child: valueWidget ?? Text(value!, textAlign: TextAlign.end, style: valueStyle),
            ),
          ),
        ],
      ),
    );
  }
}

/// A column of [KeyValueRow]s with hairline dividers between them.
class KeyValueList extends StatelessWidget {
  const KeyValueList({super.key, required this.rows, this.dividers = true});

  final List<KeyValueRow> rows;
  final bool dividers;

  @override
  Widget build(BuildContext context) {
    final border = context.lb.border;
    return Column(
      children: [
        for (var i = 0; i < rows.length; i++) ...[
          if (i > 0 && dividers) Divider(height: 1, color: border),
          rows[i],
        ],
      ],
    );
  }
}
