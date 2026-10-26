import 'package:flutter/material.dart';

import 'tokens.dart';

const List<FontFeature> _tabular = [FontFeature.tabularFigures()];

/// Text style helpers. Numbers always go through [LbText.number] so digits
/// line up in columns (IBM Plex Mono with tabular figures).
abstract final class LbText {
  /// Mono tabular figures, default 14sp weight 500, in the foreground color
  /// unless [color] is given.
  static TextStyle number(
    BuildContext context, {
    double size = 14,
    FontWeight weight = FontWeight.w500,
    Color? color,
    double? letterSpacing,
  }) =>
      TextStyle(
        fontFamily: kFontMono,
        fontSize: size,
        fontWeight: weight,
        color: color ?? context.lb.foreground,
        letterSpacing: letterSpacing,
        fontFeatures: _tabular,
      );

  /// Hero figure (equity): 34sp mono semibold, tracking -0.6.
  static TextStyle display(BuildContext context, {Color? color}) =>
      number(context, size: 34, weight: FontWeight.w600, color: color, letterSpacing: -0.6)
          .copyWith(height: 1.1);

  /// Muted secondary text (13sp).
  static TextStyle muted(BuildContext context, {double size = 13}) => TextStyle(
        fontFamily: kFontSans,
        fontSize: size,
        fontWeight: FontWeight.w400,
        color: context.lb.mutedForeground,
        height: 1.35,
      );

  /// Small uppercase-label style (11.5sp, medium, tracked).
  static TextStyle caption(BuildContext context, {Color? color}) => TextStyle(
        fontFamily: kFontSans,
        fontSize: 11.5,
        fontWeight: FontWeight.w500,
        color: color ?? context.lb.mutedForeground,
        letterSpacing: 0.2,
        height: 1.3,
      );
}

/// Builds the Material [TextTheme] from the DESIGN.md scale. No clamping:
/// scaling is left to the platform text scaler.
TextTheme buildLongbowTextTheme(LongbowColors c) {
  TextStyle sans(double size, FontWeight w, {double ls = 0, Color? color, double h = 1.35}) => TextStyle(
        fontFamily: kFontSans,
        fontSize: size,
        fontWeight: w,
        letterSpacing: ls,
        color: color ?? c.foreground,
        height: h,
      );
  final TextStyle mono = TextStyle(
    fontFamily: kFontMono,
    color: c.foreground,
    fontFeatures: _tabular,
    fontWeight: FontWeight.w600,
  );
  return TextTheme(
    displayLarge: mono.copyWith(fontSize: 34, letterSpacing: -0.6, height: 1.1),
    displayMedium: mono.copyWith(fontSize: 34, letterSpacing: -0.6, height: 1.1),
    displaySmall: mono.copyWith(fontSize: 28, letterSpacing: -0.4, height: 1.1),
    headlineLarge: sans(28, FontWeight.w600, ls: -0.4, h: 1.2),
    headlineMedium: sans(28, FontWeight.w600, ls: -0.4, h: 1.2),
    headlineSmall: sans(22, FontWeight.w600, ls: -0.3, h: 1.25),
    titleLarge: sans(20, FontWeight.w600, ls: -0.2, h: 1.25),
    titleMedium: sans(15, FontWeight.w600),
    titleSmall: sans(13.5, FontWeight.w600),
    bodyLarge: sans(15, FontWeight.w400, h: 1.45),
    bodyMedium: sans(15, FontWeight.w400, h: 1.45),
    bodySmall: sans(13, FontWeight.w400, color: c.mutedForeground),
    labelLarge: sans(13, FontWeight.w500, ls: 0.1),
    labelMedium: sans(13, FontWeight.w500, ls: 0.1),
    labelSmall: sans(11.5, FontWeight.w500, ls: 0.2, color: c.mutedForeground),
  );
}
