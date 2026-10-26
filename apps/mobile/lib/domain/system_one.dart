// Dart port of `apps/web/src/lib/systemOne.ts`. Pure Dart: no Flutter imports.
import 'package:longbow/models/models.dart';

/// Visual weight of the System One status dot.
enum SystemOneTone { ok, warn, bad, muted }

/// Short status word, e.g. "Rate limited".
String systemOneLabel(SystemOneState state) => switch (state) {
      SystemOneState.ok => 'OK',
      SystemOneState.degraded => 'Degraded',
      SystemOneState.rateLimited => 'Rate limited',
      SystemOneState.payment => 'Payment required',
      SystemOneState.unconfigured => 'Not configured',
    };

/// Visual weight for the status dot: green, amber, red, or muted.
SystemOneTone systemOneTone(SystemOneState state) => switch (state) {
      SystemOneState.ok => SystemOneTone.ok,
      SystemOneState.degraded || SystemOneState.rateLimited => SystemOneTone.warn,
      SystemOneState.payment => SystemOneTone.bad,
      SystemOneState.unconfigured => SystemOneTone.muted,
    };

/// "42 calls today, 150 ms median"; the median is omitted when unknown.
String systemOneStatsLine({required int calls24h, int? medianLatencyMs}) {
  final calls = '$calls24h call${calls24h == 1 ? '' : 's'} today';
  return medianLatencyMs == null ? calls : '$calls, $medianLatencyMs ms median';
}

/// Cooldown to show on the chip: only rate limits and payment holds carry one.
/// Returns null for every other state, even if a stale timestamp lingers.
int? systemOneCooldownUntil(SystemOneState state, int? cooldownUntil) =>
    (state == SystemOneState.rateLimited || state == SystemOneState.payment)
        ? cooldownUntil
        : null;
