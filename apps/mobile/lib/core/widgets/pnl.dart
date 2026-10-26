import 'package:flutter/material.dart';

import '../format.dart';
import '../theme/theme.dart';
import 'tone.dart';

/// Profit and loss: signed dollars and/or percent, e.g. "+$42.10 (+1.20%)".
///
/// Gain is green, loss red, flat muted. The sign glyph (+ or U+2212) carries
/// the meaning too, so color is never the only signal. Provide [amount],
/// [percent], or both; the tone follows [amount] when present. Text wraps
/// at large text scales.
class Pnl extends StatelessWidget {
  const Pnl({
    super.key,
    this.amount,
    this.percent,
    this.showAmount = true,
    this.size = 14,
    this.weight = FontWeight.w500,
    this.textAlign,
  }) : assert(amount != null || percent != null, 'Pnl needs an amount or a percent');

  final num? amount;
  final num? percent;
  final bool showAmount;
  final double size;
  final FontWeight weight;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    final t = tone((amount ?? percent)!);
    final color = context.lb.forTone(t);
    final hasAmount = amount != null && showAmount;
    final hasPct = percent != null;
    final amountText = hasAmount ? usdSigned(amount!) : '';
    final pctText = hasPct ? pctSigned(percent!) : '';
    final style = LbText.number(context, size: size, weight: weight, color: color);

    final spans = <InlineSpan>[
      if (hasAmount) TextSpan(text: amountText),
      if (hasPct && hasAmount) TextSpan(text: ' ($pctText)', style: TextStyle(color: color.withValues(alpha: 0.85))),
      if (hasPct && !hasAmount) TextSpan(text: pctText),
    ];
    final verb = switch (t) { Tone.gain => 'Up', Tone.loss => 'Down', Tone.flat => 'Flat' };
    final label = [verb, if (hasAmount) usd(amount!.abs()), if (hasPct) '${pct(percent!.abs())} percent']
        .join(' ');
    return Semantics(
      label: label,
      child: ExcludeSemantics(
        child: Text.rich(TextSpan(children: spans), style: style, textAlign: textAlign),
      ),
    );
  }
}
