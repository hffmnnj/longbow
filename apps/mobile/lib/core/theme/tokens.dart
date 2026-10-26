import 'package:flutter/material.dart';

/// Longbow color tokens. Values come from the web app's CSS variables
/// (oklch converted to sRGB); see `apps/mobile/DESIGN.md`. Call sites read
/// `context.lb.gain`, never a literal.
@immutable
class LongbowColors extends ThemeExtension<LongbowColors> {
  const LongbowColors({
    required this.background,
    required this.foreground,
    required this.card,
    required this.popover,
    required this.bar,
    required this.secondary,
    required this.muted,
    required this.mutedForeground,
    required this.accent,
    required this.border,
    required this.input,
    required this.primary,
    required this.primaryForeground,
    required this.destructive,
    required this.gain,
    required this.loss,
    required this.warn,
    required this.warnBg,
    required this.live,
    required this.lab,
    required this.labBg,
  });

  final Color background;
  final Color foreground;
  final Color card;
  final Color popover;

  /// Top bar, bottom navigation, and sheet chrome.
  final Color bar;
  final Color secondary;
  final Color muted;
  final Color mutedForeground;
  final Color accent;
  final Color border;

  /// Strong outline for inputs and chart axes.
  final Color input;

  /// The one steel-blue accent.
  final Color primary;
  final Color primaryForeground;
  final Color destructive;

  /// Reserved for positive P&L and buys.
  final Color gain;

  /// Reserved for negative P&L and sells.
  final Color loss;

  /// Warnings and halts.
  final Color warn;
  final Color warnBg;

  /// Live-account indicator.
  final Color live;

  /// Simulation lab (paper money) accent and its tinted surface.
  final Color lab;
  final Color labBg;

  static const LongbowColors dark = LongbowColors(
    background: Color(0xFF0D0E11),
    foreground: Color(0xFFE5E8EC),
    card: Color(0xFF141619),
    popover: Color(0xFF1C1E22),
    bar: Color(0xFF121417),
    secondary: Color(0xFF1F2225),
    muted: Color(0xFF1B1D20),
    mutedForeground: Color(0xFF999FA6),
    accent: Color(0xFF26292E),
    border: Color(0xFF2B2E32),
    input: Color(0xFF52565B),
    primary: Color(0xFF6DBBE8),
    primaryForeground: Color(0xFF0D1014),
    destructive: Color(0xFFF66D67),
    gain: Color(0xFF5FD37F),
    loss: Color(0xFFFD736D),
    warn: Color(0xFFE9B452),
    warnBg: Color(0xFF362607),
    live: Color(0xFF6DBBE8),
    lab: Color(0xFFC2A7F4),
    labBg: Color(0xFF1C1625),
  );

  static const LongbowColors light = LongbowColors(
    background: Color(0xFFF6F7F8),
    foreground: Color(0xFF171B20),
    card: Color(0xFFFFFFFF),
    popover: Color(0xFFFFFFFF),
    bar: Color(0xFFFFFFFF),
    secondary: Color(0xFFEDF0F2),
    muted: Color(0xFFEDF0F2),
    mutedForeground: Color(0xFF555B63),
    accent: Color(0xFFE7EAED),
    border: Color(0xFFDBDEE1),
    input: Color(0xFFBABEC3),
    primary: Color(0xFF005C96),
    primaryForeground: Color(0xFFFAFAFA),
    destructive: Color(0xFFBB0916),
    gain: Color(0xFF006E30),
    loss: Color(0xFFBE2323),
    warn: Color(0xFF975800),
    warnBg: Color(0xFFFEEDC9),
    live: Color(0xFF1777B8),
    lab: Color(0xFF68449C),
    labBg: Color(0xFFF2EDFC),
  );

  @override
  LongbowColors copyWith({
    Color? background,
    Color? foreground,
    Color? card,
    Color? popover,
    Color? bar,
    Color? secondary,
    Color? muted,
    Color? mutedForeground,
    Color? accent,
    Color? border,
    Color? input,
    Color? primary,
    Color? primaryForeground,
    Color? destructive,
    Color? gain,
    Color? loss,
    Color? warn,
    Color? warnBg,
    Color? live,
    Color? lab,
    Color? labBg,
  }) {
    return LongbowColors(
      background: background ?? this.background,
      foreground: foreground ?? this.foreground,
      card: card ?? this.card,
      popover: popover ?? this.popover,
      bar: bar ?? this.bar,
      secondary: secondary ?? this.secondary,
      muted: muted ?? this.muted,
      mutedForeground: mutedForeground ?? this.mutedForeground,
      accent: accent ?? this.accent,
      border: border ?? this.border,
      input: input ?? this.input,
      primary: primary ?? this.primary,
      primaryForeground: primaryForeground ?? this.primaryForeground,
      destructive: destructive ?? this.destructive,
      gain: gain ?? this.gain,
      loss: loss ?? this.loss,
      warn: warn ?? this.warn,
      warnBg: warnBg ?? this.warnBg,
      live: live ?? this.live,
      lab: lab ?? this.lab,
      labBg: labBg ?? this.labBg,
    );
  }

  @override
  LongbowColors lerp(ThemeExtension<LongbowColors>? other, double t) {
    if (other is! LongbowColors) return this;
    Color mix(Color a, Color b) => Color.lerp(a, b, t)!;
    return LongbowColors(
      background: mix(background, other.background),
      foreground: mix(foreground, other.foreground),
      card: mix(card, other.card),
      popover: mix(popover, other.popover),
      bar: mix(bar, other.bar),
      secondary: mix(secondary, other.secondary),
      muted: mix(muted, other.muted),
      mutedForeground: mix(mutedForeground, other.mutedForeground),
      accent: mix(accent, other.accent),
      border: mix(border, other.border),
      input: mix(input, other.input),
      primary: mix(primary, other.primary),
      primaryForeground: mix(primaryForeground, other.primaryForeground),
      destructive: mix(destructive, other.destructive),
      gain: mix(gain, other.gain),
      loss: mix(loss, other.loss),
      warn: mix(warn, other.warn),
      warnBg: mix(warnBg, other.warnBg),
      live: mix(live, other.live),
      lab: mix(lab, other.lab),
      labBg: mix(labBg, other.labBg),
    );
  }
}

/// Bundled font families (declared in pubspec.yaml under flutter.fonts).
const String kFontSans = 'IBM Plex Sans';
const String kFontMono = 'IBM Plex Mono';

/// Radii in logical pixels, matching the web `--radius` scale.
abstract final class LbRadius {
  static const double sm = 6;
  static const double md = 10;
  static const double lg = 14;
  static const double xl = 20;
}

/// Spacing on a 4dp grid.
abstract final class LbSpace {
  static const double unit = 4;
  static const double screen = 16;
  static const double card = 14;
  static const double gap = 12;
}

extension LongbowThemeContext on BuildContext {
  /// The Longbow color tokens for the current brightness.
  LongbowColors get lb => Theme.of(this).extension<LongbowColors>()!;
}
