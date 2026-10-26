import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Semantic color roles for charts. Gain and loss keep their money meaning:
/// only use them for P&L and buy/sell, never for decoration.
enum ChartTone { primary, gain, loss, warn, lab, muted }

/// Chart-specific color roles derived from [LongbowColors]. Every chart reads
/// its colors from here, so a tone change is one edit.
@immutable
class ChartPalette {
  const ChartPalette(this.colors);

  factory ChartPalette.of(BuildContext context) => ChartPalette(context.lb);

  final LongbowColors colors;

  /// Default series line.
  Color get line => colors.primary;

  /// Second, dashed comparison line (benchmark such as SPY).
  Color get benchmark => colors.mutedForeground.withValues(alpha: 0.85);

  /// Horizontal grid rules.
  Color get grid => colors.border.withValues(alpha: 0.45);

  /// Axis rules and the zero line.
  Color get axis => colors.input;

  /// Axis labels.
  Color get axisText => colors.mutedForeground;

  /// Scrub crosshair line.
  Color get crosshair => colors.mutedForeground.withValues(alpha: 0.7);

  /// Ring behind the scrub dot, so it reads on top of the fill.
  Color get dotRing => colors.card;

  Color get markerBuy => colors.gain;
  Color get markerSell => colors.loss;
  Color get markerNeutral => colors.mutedForeground;

  Color get candleUp => colors.gain;
  Color get candleDown => colors.loss;

  /// Readout bubble surface and outline.
  Color get bubble => colors.popover.withValues(alpha: 0.96);
  Color get bubbleBorder => colors.border;

  Color tone(ChartTone t) => switch (t) {
    ChartTone.primary => colors.primary,
    ChartTone.gain => colors.gain,
    ChartTone.loss => colors.loss,
    ChartTone.warn => colors.warn,
    ChartTone.lab => colors.lab,
    ChartTone.muted => colors.mutedForeground,
  };

  /// Gain when the series ended at or above where it began, loss otherwise.
  ChartTone autoTone(bool up) => up ? ChartTone.gain : ChartTone.loss;

  /// Colors cycled for multi-series charts without explicit tones.
  static const List<ChartTone> cycle = [
    ChartTone.primary,
    ChartTone.lab,
    ChartTone.warn,
    ChartTone.gain,
    ChartTone.loss,
    ChartTone.muted,
  ];

  @override
  bool operator ==(Object other) =>
      other is ChartPalette &&
      (identical(other.colors, colors) ||
          (other.colors.primary == colors.primary &&
              other.colors.gain == colors.gain &&
              other.colors.loss == colors.loss &&
              other.colors.warn == colors.warn &&
              other.colors.lab == colors.lab &&
              other.colors.mutedForeground == colors.mutedForeground &&
              other.colors.border == colors.border &&
              other.colors.input == colors.input &&
              other.colors.card == colors.card &&
              other.colors.popover == colors.popover &&
              other.colors.foreground == colors.foreground));

  @override
  int get hashCode => Object.hash(
    colors.primary,
    colors.gain,
    colors.loss,
    colors.border,
    colors.card,
    colors.mutedForeground,
  );
}

/// Text style for axis labels and readouts: Plex Mono, tabular figures.
TextStyle chartTextStyle(
  Color color, {
  double size = 10.5,
  FontWeight? weight,
}) => TextStyle(
  fontFamily: kFontMono,
  fontSize: size,
  height: 1.2,
  color: color,
  fontWeight: weight,
  fontFeatures: const [FontFeature.tabularFigures()],
);
