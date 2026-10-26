import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/domain/system_one.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('systemOne_labelCoversEveryState', () {
    expect(systemOneLabel(SystemOneState.ok), 'OK');
    expect(systemOneLabel(SystemOneState.degraded), 'Degraded');
    expect(systemOneLabel(SystemOneState.rateLimited), 'Rate limited');
    expect(systemOneLabel(SystemOneState.payment), 'Payment required');
    expect(systemOneLabel(SystemOneState.unconfigured), 'Not configured');
  });

  test('systemOne_toneMapsToDotWeight', () {
    expect(systemOneTone(SystemOneState.ok), SystemOneTone.ok);
    expect(systemOneTone(SystemOneState.degraded), SystemOneTone.warn);
    expect(systemOneTone(SystemOneState.rateLimited), SystemOneTone.warn);
    expect(systemOneTone(SystemOneState.payment), SystemOneTone.bad);
    expect(systemOneTone(SystemOneState.unconfigured), SystemOneTone.muted);
  });

  test('systemOne_statsLineCountsCallsAndOptionalMedian', () {
    expect(
      systemOneStatsLine(calls24h: 42, medianLatencyMs: 150),
      '42 calls today, 150 ms median',
    );
    expect(systemOneStatsLine(calls24h: 42), '42 calls today');
    expect(systemOneStatsLine(calls24h: 1), '1 call today');
  });

  test('systemOne_cooldownOnlyForRateLimitAndPayment', () {
    expect(
      systemOneCooldownUntil(SystemOneState.rateLimited, 123),
      123,
    );
    expect(systemOneCooldownUntil(SystemOneState.payment, 123), 123);
    expect(systemOneCooldownUntil(SystemOneState.ok, 123), isNull);
    expect(systemOneCooldownUntil(SystemOneState.degraded, 123), isNull);
    expect(systemOneCooldownUntil(SystemOneState.unconfigured, 123), isNull);
    expect(systemOneCooldownUntil(SystemOneState.rateLimited, null), isNull);
  });
}
