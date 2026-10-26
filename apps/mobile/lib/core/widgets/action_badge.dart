import 'package:flutter/material.dart';

import '../theme/theme.dart';

Widget _tag(BuildContext context, String text, Color fg, Color bg, {double minWidth = 0}) {
  return DecoratedBox(
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(LbRadius.sm)),
    child: ConstrainedBox(
      constraints: BoxConstraints(minWidth: minWidth, minHeight: 22),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: Center(
          widthFactor: 1,
          child: Text(
            text.toUpperCase(),
            style: TextStyle(
              fontFamily: kFontSans,
              fontSize: 10.5,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.8,
              color: fg,
            ),
          ),
        ),
      ),
    ),
  );
}

/// Journal action tag: buy (gain), sell (loss), everything else
/// (hold, watch, none) muted. [action] is the server string, any case.
class ActionBadge extends StatelessWidget {
  const ActionBadge(this.action, {super.key});

  final String action;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final a = action.toLowerCase();
    final (Color fg, Color bg) = switch (a) {
      'buy' => (c.gain, Color.alphaBlend(c.gain.withValues(alpha: 0.15), c.card)),
      'sell' => (c.loss, Color.alphaBlend(c.loss.withValues(alpha: 0.15), c.card)),
      _ => (c.mutedForeground, c.muted),
    };
    return Semantics(
      label: 'Action $a',
      child: ExcludeSemantics(child: _tag(context, a, fg, bg, minWidth: 48)),
    );
  }
}

/// Order side tag: BUY (gain) or SELL (loss). [side] is 'buy' or 'sell'.
class SideBadge extends StatelessWidget {
  const SideBadge(this.side, {super.key});

  final String side;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final buy = side.toLowerCase() == 'buy';
    final fg = buy ? c.gain : c.loss;
    return Semantics(
      label: buy ? 'Buy' : 'Sell',
      child: ExcludeSemantics(
        child: _tag(context, buy ? 'buy' : 'sell', fg, Color.alphaBlend(fg.withValues(alpha: 0.15), c.card)),
      ),
    );
  }
}
