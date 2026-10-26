import 'package:flutter/services.dart';

/// Haptic feedback at commit moments only (approve, reject, kill switch, mode
/// change, send, tab change). Every call is fire-and-forget and never throws.
abstract final class Haptics {
  static void _run(Future<void> Function() f) {
    try {
      f().catchError((Object _) {});
    } catch (_) {}
  }

  /// Tab or segment change.
  static void selection() => _run(HapticFeedback.selectionClick);
  static void light() => _run(HapticFeedback.lightImpact);
  static void medium() => _run(HapticFeedback.mediumImpact);
  static void heavy() => _run(HapticFeedback.heavyImpact);

  /// Order approved, copied, saved.
  static void success() => _run(HapticFeedback.mediumImpact);

  /// Confirmations of risky actions.
  static void warning() => _run(HapticFeedback.mediumImpact);

  /// Rejected, failed, kill switch.
  static void error() => _run(HapticFeedback.heavyImpact);
}
