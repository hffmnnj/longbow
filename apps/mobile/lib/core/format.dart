import 'dart:math' as math;

import 'package:intl/intl.dart';

/// Dart port of `apps/web/src/lib/format.ts`. Same output strings, same
/// rounding rules, real minus sign (U+2212) for negatives.
const String kMinus = '\u2212';

final NumberFormat _money = NumberFormat('#,##0.00', 'en_US');
final NumberFormat _num = NumberFormat('#,##0.####', 'en_US');
final NumberFormat _pct = NumberFormat('0.00', 'en_US');

enum Tone { gain, loss, flat }

/// A UTC offset plus a short zone name, for timestamp formatting.
///
/// Time helpers default to the device zone ([LbZone.local]); tests pass an
/// explicit zone such as `LbZone(Duration(hours: -4), 'EDT')`.
class LbZone {
  const LbZone(this.offset, this.name);

  final Duration offset;
  final String name;

  /// The device zone as it applies at [ms] (DST aware).
  factory LbZone.local(int ms) {
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    return LbZone(d.timeZoneOffset, d.timeZoneName);
  }

  static const LbZone utc = LbZone(Duration.zero, 'UTC');

  /// Wall-clock fields of [ms] in this zone, carried by a UTC [DateTime].
  DateTime wall(int ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true).add(offset);
}

LbZone _zone(int ms, LbZone? z) => z ?? LbZone.local(ms);

String _two(int n) => n.toString().padLeft(2, '0');

const List<String> _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const List<String> _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// $1,234.50 (always two decimals). Negative values use a true minus sign.
String usd(num value) {
  final s = '\$${_money.format(value.abs())}';
  return value < 0 && value.abs() >= 0.005 ? '$kMinus$s' : s;
}

/// +$1,234.50 or −$1,234.50; zero has no sign.
String usdSigned(num value) {
  if (value.abs() < 0.005) return '\$${_money.format(0)}';
  return '${value > 0 ? '+' : kMinus}\$${_money.format(value.abs())}';
}

/// +1.25% or −0.40%; zero has no sign. [value] is already a percentage.
String pctSigned(num value) {
  if (value.abs() < 0.005) return '${_pct.format(0)}%';
  return '${value > 0 ? '+' : kMinus}${_pct.format(value.abs())}%';
}

/// 12.50% (two decimals, no sign handling beyond the number format).
String pct(num value) => '${_pct.format(value)}%';

/// Share quantity, up to four decimals: 1,234.5.
String qty(num value) => _num.format(value);

/// Compact count/amount: 1.2K, 3.4M, 5.6B (no currency).
String compact(num value) {
  final a = value.abs();
  String f(double v, String s) => '${v.toStringAsFixed(v.abs() >= 100 ? 0 : 1).replaceAll(RegExp(r'\.0$'), '')}$s';
  final sign = value < 0 ? kMinus : '';
  if (a >= 1e9) return sign + f(a / 1e9, 'B');
  if (a >= 1e6) return sign + f(a / 1e6, 'M');
  if (a >= 1e3) return sign + f(a / 1e3, 'K');
  return sign + _num.format(a);
}

/// Sub-cent values are flat.
Tone tone(num value) {
  if (value.abs() < 0.005) return Tone.flat;
  return value > 0 ? Tone.gain : Tone.loss;
}

/// 14:05 MST (device zone, or [zone] when given). Midnight is 00, not 24.
String etTime(int ms, {LbZone? zone}) {
  final z = _zone(ms, zone);
  final w = z.wall(ms);
  return '${_two(w.hour)}:${_two(w.minute)} ${z.name}';
}

/// 14:05:09 MST
String etClock(int ms, {LbZone? zone}) {
  final z = _zone(ms, zone);
  final w = z.wall(ms);
  return '${_two(w.hour)}:${_two(w.minute)}:${_two(w.second)} ${z.name}';
}

/// "14:05 MST" for today, "Oct 23 14:05 MST" otherwise. [now] is epoch ms.
String etStamp(int ms, {int? now, LbZone? zone}) {
  final n = now ?? DateTime.now().millisecondsSinceEpoch;
  final same = etDayKey(ms, zone: zone) == etDayKey(n, zone: zone);
  return same ? etTime(ms, zone: zone) : '${_md(ms, zone)} ${etTime(ms, zone: zone)}';
}

String _md(int ms, LbZone? zone) {
  final w = _zone(ms, zone).wall(ms);
  return '${_months[w.month - 1]} ${w.day}';
}

/// "Mon Oct 26"
String etDay(int ms, {LbZone? zone}) {
  final w = _zone(ms, zone).wall(ms);
  return '${_weekdays[w.weekday - 1]} ${_months[w.month - 1]} ${w.day}';
}

/// Calendar day as YYYY-MM-DD in the device zone, for "today" comparisons.
String etDayKey(int ms, {LbZone? zone}) {
  final w = _zone(ms, zone).wall(ms);
  return '${w.year.toString().padLeft(4, '0')}-${_two(w.month)}-${_two(w.day)}';
}

/// 3h 12m, 5m 07s, 45s, 2d 2h.
String countdown(int ms) {
  final total = math.max(0, (ms / 1000).floor());
  final d = total ~/ 86400;
  final h = (total % 86400) ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = total % 60;
  if (d > 0) return '${d}d ${h}h';
  if (h > 0) return '${h}h ${_two(m)}m';
  if (m > 0) return '${m}m ${_two(s)}s';
  return '${s}s';
}

/// just now, 4m ago, 3h ago, then a date.
String ago(int ms, {int? now, LbZone? zone}) {
  final n = now ?? DateTime.now().millisecondsSinceEpoch;
  final diff = math.max(0, n - ms);
  if (diff < 45000) return 'just now';
  if (diff < 3600000) return '${(diff / 60000).round()}m ago';
  if (diff < 86400000) return '${diff ~/ 3600000}h ago';
  return _md(ms, zone);
}

/// 412ms, 1.8s, 12s, 1m 05s.
String durationShort(num ms) {
  if (ms < 1000) return '${ms.round()}ms';
  final s = ms / 1000;
  if (s < 10) return '${s.toStringAsFixed(1)}s';
  if (s < 60) return '${s.round()}s';
  return '${s ~/ 60}m ${_two((s % 60).round())}s';
}

/// "2026-10-05" -> "Oct 5". Falls back to the input when it is not a date.
String isoShort(String iso) {
  final d = DateTime.tryParse('${iso}T00:00:00Z');
  return d == null ? iso : '${_months[d.month - 1]} ${d.day}';
}

/// "2026-10-26" -> "Mon, Oct 26". Falls back to the input when it is not a date.
String isoDay(String iso) {
  final d = DateTime.tryParse('${iso}T00:00:00Z');
  return d == null ? iso : '${_weekdays[d.weekday - 1]}, ${_months[d.month - 1]} ${d.day}';
}

/// 4.18 -> "4.18%" for yields.
String yieldPct(num v) => '${v.toStringAsFixed(2)}%';

/// Dollars without cents for axes and big figures: $25,432.
String usd0(num value) => usd(value.round()).replaceAll(RegExp(r'\.00$'), '');

/// 41200000 -> "$41M", for dollar volume.
String usdCompact(num value) {
  final a = value.abs();
  if (a >= 1e9) return '\$${(value / 1e9).toStringAsFixed(1)}B';
  if (a >= 1e6) return '\$${(value / 1e6).round()}M';
  if (a >= 1e3) return '\$${(value / 1e3).round()}K';
  return '\$${value.round()}';
}
