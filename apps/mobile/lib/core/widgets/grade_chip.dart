import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// Report grade A to F in a bordered square. [large] is the 44dp hero size.
/// Neutral colors on purpose: grades are not money.
class GradeChip extends StatelessWidget {
  const GradeChip(this.grade, {super.key, this.large = false, this.reason});

  final String grade;
  final bool large;

  /// Spoken after the grade by screen readers.
  final String? reason;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final size = large ? 44.0 : 28.0;
    return Semantics(
      label: reason == null ? 'Grade $grade' : 'Grade $grade: $reason',
      child: ExcludeSemantics(
        child: Container(
          constraints: BoxConstraints(minWidth: size, minHeight: size),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: c.secondary,
            borderRadius: BorderRadius.circular(LbRadius.md),
            border: Border.all(color: c.border),
          ),
          child: Text(grade, style: LbText.number(context, size: large ? 21 : 13, weight: FontWeight.w700)),
        ),
      ),
    );
  }
}
