import 'package:flutter/material.dart';

import '../format.dart';
import '../theme/theme.dart';
import 'tone.dart';

/// A dollar amount in tabular mono. `Money(12.5)` -> "$12.50".
///
/// [signed] adds +/− (zero stays unsigned). [colored] tints gain/loss/flat;
/// pair it with [signed] so color is never the only signal. [whole] drops
/// cents ("$25,432").
class Money extends StatelessWidget {
  const Money(
    this.value, {
    super.key,
    this.signed = false,
    this.colored = false,
    this.whole = false,
    this.size = 14,
    this.weight = FontWeight.w500,
    this.color,
    this.textAlign,
  });

  final num value;
  final bool signed;
  final bool colored;
  final bool whole;
  final double size;
  final FontWeight weight;

  /// Overrides the tone color.
  final Color? color;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    final text = signed ? usdSigned(value) : (whole ? usd0(value) : usd(value));
    final c = color ?? (colored ? context.lb.forTone(tone(value)) : null);
    return Text(text, textAlign: textAlign, style: LbText.number(context, size: size, weight: weight, color: c));
  }
}

/// A percentage ([value] is already a percent: 1.25 -> "1.25%").
/// [signed] adds +/−; [colored] tints by sign.
class PctText extends StatelessWidget {
  const PctText(
    this.value, {
    super.key,
    this.signed = true,
    this.colored = true,
    this.size = 14,
    this.weight = FontWeight.w500,
    this.color,
    this.textAlign,
  });

  final num value;
  final bool signed;
  final bool colored;
  final double size;
  final FontWeight weight;
  final Color? color;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    final c = color ?? (colored ? context.lb.forTone(tone(value)) : null);
    return Text(
      signed ? pctSigned(value) : pct(value),
      textAlign: textAlign,
      style: LbText.number(context, size: size, weight: weight, color: c),
    );
  }
}
