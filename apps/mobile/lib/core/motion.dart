import 'package:flutter/widgets.dart';

/// Motion tokens. Every animation duration goes through [LbMotion.duration]
/// so reduced motion (system "remove animations") collapses it to zero.
abstract final class LbMotion {
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration base = Duration(milliseconds: 200);
  static const Duration sheet = Duration(milliseconds: 300);
  static const Curve curve = Curves.easeOutCubic;

  /// [base] unless the platform asks for no animations, then zero.
  static Duration duration(BuildContext context, [Duration base = LbMotion.base]) =>
      MediaQuery.disableAnimationsOf(context) ? Duration.zero : base;

  /// True when decorative or looping motion must not run.
  static bool reduced(BuildContext context) => MediaQuery.disableAnimationsOf(context);
}
