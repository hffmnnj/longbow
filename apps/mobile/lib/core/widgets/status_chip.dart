import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme/theme.dart';
import 'pulse_dot.dart';

/// Colour family of a [StatusChip].
enum StatusTone { neutral, live, warn, loss, gain, lab }

/// Small pill with an optional icon and a word, so status never relies on
/// color alone. `StatusChip('Live', tone: StatusTone.live)` shows a pulse dot;
/// pass [icon] to override the default glyph for the tone.
class StatusChip extends StatelessWidget {
  const StatusChip(this.label, {super.key, this.tone = StatusTone.neutral, this.icon, this.showIcon = true});

  final String label;
  final StatusTone tone;

  /// Replaces the tone's default icon.
  final IconData? icon;

  /// Set false for a text-only chip.
  final bool showIcon;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final (Color fg, Color bg) = switch (tone) {
      StatusTone.neutral => (c.mutedForeground, c.muted),
      // Text uses primary: `live` is only 4.0:1 on its tint in the light theme.
      StatusTone.live => (c.primary, Color.alphaBlend(c.live.withValues(alpha: 0.14), c.card)),
      StatusTone.warn => (c.warn, c.warnBg),
      StatusTone.loss => (c.loss, Color.alphaBlend(c.loss.withValues(alpha: 0.14), c.card)),
      StatusTone.gain => (c.gain, Color.alphaBlend(c.gain.withValues(alpha: 0.14), c.card)),
      StatusTone.lab => (c.lab, c.labBg),
    };
    final IconData? glyph = icon ??
        switch (tone) {
          StatusTone.neutral || StatusTone.live => null,
          StatusTone.warn => LbIcons.alert02,
          StatusTone.loss => LbIcons.alertCircle,
          StatusTone.gain => LbIcons.checkmarkCircle02,
          StatusTone.lab => LbIcons.flaskConical,
        };
    final Widget? lead = !showIcon
        ? null
        : glyph != null
            ? LbIcon(glyph, size: 14, color: fg)
            : tone == StatusTone.live
                ? PulseDot(color: fg, size: 7)
                : null;
    return DecoratedBox(
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(LbRadius.sm)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 24),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (lead != null) ...[lead, const SizedBox(width: 5)],
              Flexible(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.labelMedium!.copyWith(color: fg, fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
