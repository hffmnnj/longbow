import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/format.dart';

const _ny = LbZone(Duration(hours: -4), 'EDT');
const _nyWinter = LbZone(Duration(hours: -5), 'EST');

void main() {
  group('currency', () {
    test('formats two decimals with thousands separators', () {
      expect(usd(1234567.8), r'$1,234,567.80');
      expect(usd(0), r'$0.00');
    });
    test('uses a real minus sign for negatives', () {
      expect(usd(-12.5), '\u2212\$12.50');
    });
    test('does not sign sub-cent negatives', () {
      expect(usd(-0.001), r'$0.00');
    });
    test('prefixes signed amounts and leaves zero unsigned', () {
      expect(usdSigned(42.1), r'+$42.10');
      expect(usdSigned(-42.1), '\u2212\$42.10');
      expect(usdSigned(0.001), r'$0.00');
      expect(usdSigned(-0.001), r'$0.00');
    });
    test('usd0 drops cents and usdCompact abbreviates', () {
      expect(usd0(25432.4), r'$25,432');
      expect(usdCompact(41200000), r'$41M');
      expect(usdCompact(2500000000), r'$2.5B');
      expect(usdCompact(12500), r'$13K');
    });
  });

  group('percent and quantity', () {
    test('signs and rounds to two decimals', () {
      expect(pctSigned(1.2345), '+1.23%');
      expect(pctSigned(-0.4), '\u22120.40%');
      expect(pctSigned(0), '0.00%');
      expect(pct(12.5), '12.50%');
    });
    test('qty keeps up to four decimals', () {
      expect(qty(1234.56789), '1,234.5679');
      expect(qty(3), '3');
    });
    test('compact abbreviates thousands, millions, billions', () {
      expect(compact(1200), '1.2K');
      expect(compact(3400000), '3.4M');
      expect(compact(-5600000000), '\u22125.6B');
      expect(compact(999), '999');
    });
  });

  group('tone', () {
    test('treats sub-cent values as flat', () {
      expect(tone(0.004), Tone.flat);
      expect(tone(3), Tone.gain);
      expect(tone(-3), Tone.loss);
    });
  });

  group('time zone formatting', () {
    test('renders in the requested zone across DST', () {
      // 2026-07-01T14:05:09Z is 10:05:09 EDT; 2026-01-15T14:05:09Z is 09:05:09 EST.
      expect(etClock(DateTime.utc(2026, 7, 1, 14, 5, 9).millisecondsSinceEpoch, zone: _ny), '10:05:09 EDT');
      expect(etTime(DateTime.utc(2026, 1, 15, 14, 5, 9).millisecondsSinceEpoch, zone: _nyWinter), '09:05 EST');
    });
    test('renders midnight as 00, not 24', () {
      expect(etTime(DateTime.utc(2026, 1, 15, 5).millisecondsSinceEpoch, zone: _nyWinter), '00:00 EST');
    });
    test('defaults to the device zone with the expected shape', () {
      expect(etTime(DateTime.utc(2026, 1, 15, 14, 5, 9).millisecondsSinceEpoch), matches(RegExp(r'^\d{2}:\d{2} \S+$')));
    });
    test('etStamp omits the date for today and includes it otherwise', () {
      final now = DateTime.utc(2026, 10, 24, 16).millisecondsSinceEpoch; // 12:00 EDT
      final sameDay = DateTime.utc(2026, 10, 24, 18, 26).millisecondsSinceEpoch;
      final earlier = DateTime.utc(2026, 10, 23, 18, 26).millisecondsSinceEpoch;
      expect(etStamp(sameDay, now: now, zone: _ny), '14:26 EDT');
      expect(etStamp(earlier, now: now, zone: _ny), 'Oct 23 14:26 EDT');
    });
    test('day helpers follow the zone, not UTC', () {
      final lateEvening = DateTime.utc(2026, 10, 27, 2, 30).millisecondsSinceEpoch; // Oct 26 22:30 EDT
      expect(etDayKey(lateEvening, zone: _ny), '2026-10-26');
      expect(etDay(lateEvening, zone: _ny), 'Mon Oct 26');
    });
  });

  group('countdown and ago', () {
    test('picks the two most useful units', () {
      expect(countdown(45000), '45s');
      expect(countdown(5 * 60000 + 7000), '5m 07s');
      expect(countdown(3 * 3600000 + 12 * 60000), '3h 12m');
      expect(countdown(50 * 3600000), '2d 2h');
      expect(countdown(-5), '0s');
    });
    test('describes recency', () {
      final now = DateTime.utc(2026, 10, 24, 15).millisecondsSinceEpoch;
      expect(ago(now - 10000, now: now), 'just now');
      expect(ago(now - 5 * 60000, now: now), '5m ago');
      expect(ago(now - 3 * 3600000, now: now), '3h ago');
      expect(ago(now - 30 * 3600000, now: now, zone: _ny), 'Oct 23');
    });
  });

  group('durationShort', () {
    test('scales units', () {
      expect([412, 1840, 12400, 65000].map(durationShort).toList(), ['412ms', '1.8s', '12s', '1m 05s']);
    });
  });

  group('iso dates', () {
    test('format valid dates and pass through invalid ones', () {
      expect(isoShort('2026-10-05'), 'Oct 5');
      expect(isoDay('2026-10-26'), 'Mon, Oct 26');
      expect(isoShort('soon'), 'soon');
      expect(yieldPct(4.1), '4.10%');
    });
  });
}
