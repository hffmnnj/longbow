import 'dart:math' as math;

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/theme/theme.dart';

/// WCAG 2.x relative luminance, implemented independently of Flutter's.
double _lum(Color c) {
  double ch(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

double contrast(Color a, Color b) {
  final hi = math.max(_lum(a), _lum(b));
  final lo = math.min(_lum(a), _lum(b));
  return (hi + 0.05) / (lo + 0.05);
}

Color tint(Color fg, Color bg, double a) => Color.alphaBlend(fg.withValues(alpha: a), bg);

void main() {
  test('contrast helper matches the WCAG reference values', () {
    expect(contrast(const Color(0xFF000000), const Color(0xFFFFFFFF)), closeTo(21, 0.001));
    expect(contrast(const Color(0xFF777777), const Color(0xFFFFFFFF)), closeTo(4.48, 0.01));
  });

  for (final entry in {'dark': LongbowColors.dark, 'light': LongbowColors.light}.entries) {
    final c = entry.value;
    group('${entry.key} theme text contrast >= 4.5:1', () {
      final pairs = <String, (Color, Color)>{
        'foreground on background': (c.foreground, c.background),
        'foreground on card': (c.foreground, c.card),
        'foreground on popover': (c.foreground, c.popover),
        'foreground on accent': (c.foreground, c.accent),
        'mutedForeground on background': (c.mutedForeground, c.background),
        'mutedForeground on card': (c.mutedForeground, c.card),
        'mutedForeground on popover': (c.mutedForeground, c.popover),
        'mutedForeground on muted': (c.mutedForeground, c.muted),
        'mutedForeground on accent': (c.mutedForeground, c.accent),
        'primary on background': (c.primary, c.background),
        'primary on card': (c.primary, c.card),
        'primary on popover': (c.primary, c.popover),
        'primaryForeground on primary': (c.primaryForeground, c.primary),
        'gain on background': (c.gain, c.background),
        'gain on card': (c.gain, c.card),
        'loss on background': (c.loss, c.background),
        'loss on card': (c.loss, c.card),
        'loss on popover': (c.loss, c.popover),
        'destructive on card': (c.destructive, c.card),
        'destructive on popover': (c.destructive, c.popover),
        'warn on background': (c.warn, c.background),
        'warn on warnBg': (c.warn, c.warnBg),
        'lab on labBg': (c.lab, c.labBg),
        'live on card': (c.live, c.card),
        // StatusChip / ActionBadge / SideBadge tints.
        'gain on gain chip tint': (c.gain, tint(c.gain, c.card, 0.15)),
        'loss on loss chip tint': (c.loss, tint(c.loss, c.card, 0.15)),
        'primary on live chip tint': (c.primary, tint(c.live, c.card, 0.14)),
      };
      pairs.forEach((name, p) {
        test(name, () => expect(contrast(p.$1, p.$2), greaterThanOrEqualTo(4.5)));
      });
    });

    test('${entry.key}: text field outline is a 3:1 UI boundary on every surface', () {
      final border = lbFieldBorder(c);
      for (final surface in [c.background, c.card, c.popover, c.muted]) {
        expect(contrast(border, surface), greaterThanOrEqualTo(3.0));
      }
    });
  }
}
