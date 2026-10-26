import 'chart_math.dart';

/// Private-to-charts number formatting (kept apart from lib/core/format.dart).
/// Negative numbers use the real minus sign (U+2212), matching the app.

const String kMinus = '\u2212';

String _group(String digits) {
  final b = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) b.write(',');
    b.write(digits[i]);
  }
  return b.toString();
}

String _trimmed(double v, int maxDecimals) {
  var s = v.toStringAsFixed(maxDecimals);
  if (s.contains('.')) {
    s = s.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
  }
  return s;
}

/// Compact, tabular-friendly number: `1,234`, `12.3K`, `4.5M`, `0.25`.
/// Without [fractionDigits] it shows up to 2 decimals (1 from 100, 0 from
/// 1,000) and trims trailing zeros; axis ticks pass the digits their step needs
/// so labels share a width. Non-finite gives an em dash.
String formatChartNumber(double v, {int? fractionDigits}) {
  if (!v.isFinite) return '\u2014';
  final abs = v.abs();
  String body;
  if (abs >= 1e9) {
    body = '${_trimmed(abs / 1e9, 1)}B';
  } else if (abs >= 1e6) {
    body = '${_trimmed(abs / 1e6, 1)}M';
  } else if (abs >= 1e4) {
    body = '${_trimmed(abs / 1e3, abs >= 1e5 ? 0 : 1)}K';
  } else {
    final d =
        fractionDigits ??
        (abs >= 1000
            ? 0
            : abs >= 100
            ? 1
            : abs >= 1
            ? 2
            : 3);
    var fixed = abs.toStringAsFixed(d);
    if (fractionDigits == null && fixed.contains('.')) {
      fixed = fixed
          .replaceFirst(RegExp(r'0+$'), '')
          .replaceFirst(RegExp(r'\.$'), '');
    }
    final parts = fixed.split('.');
    body = parts.length == 2
        ? '${_group(parts[0])}.${parts[1]}'
        : _group(parts[0]);
  }
  final isZero = !body.contains(RegExp(r'[1-9]'));
  return v < 0 && !isZero ? '$kMinus$body' : body;
}

/// A formatter for axis ticks that shares fraction digits across all [ticks].
String Function(double) axisFormatter(List<double> ticks) {
  final step = ticks.length >= 2 ? (ticks[1] - ticks[0]).abs() : 0.0;
  final d = decimalsForStep(step);
  return (v) => formatChartNumber(v, fractionDigits: d);
}

/// Percent change from [first] to [last] as "+1.2%" or "−3.4%". Null when
/// [first] is zero or either is not finite.
String? formatChange(double first, double last) {
  if (!first.isFinite || !last.isFinite || first == 0) return null;
  final pct = (last - first) / first.abs() * 100;
  final body = pct.abs().toStringAsFixed(pct.abs() >= 100 ? 0 : 1);
  if (!body.contains(RegExp(r'[1-9]'))) return '0.0%';
  return '${pct < 0 ? kMinus : '+'}$body%';
}

/// Default spoken summary of a series: start, end and change.
String summarizeSeries(
  List<double> values, {
  String name = 'Chart',
  String Function(double)? format,
}) {
  final f = format ?? formatChartNumber;
  final idx = finiteIndices(values);
  if (idx.isEmpty) return '$name, no data';
  final first = values[idx.first];
  final last = values[idx.last];
  if (idx.length == 1) return '$name, one point at ${f(last)}';
  final change = formatChange(first, last);
  final lo = idx.map((i) => values[i]).reduce((a, b) => a < b ? a : b);
  final hi = idx.map((i) => values[i]).reduce((a, b) => a > b ? a : b);
  return '$name, ${idx.length} points, from ${f(first)} to ${f(last)}'
      '${change == null ? '' : ', $change'}, low ${f(lo)}, high ${f(hi)}';
}
