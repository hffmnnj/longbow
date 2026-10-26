import 'package:longbow/core/format.dart'
    show Tone, isoDay, isoShort, pct, pctSigned, tone, usd, usdSigned;
import 'package:longbow/models/models.dart';

/// Dart port of `apps/web/src/lib/reports.ts`. Pure presentational helpers
/// for the Reports surface.

const Map<ReportKind, String> kindLabel = {
  ReportKind.daily: 'Daily',
  ReportKind.weekly: 'Weekly',
  ReportKind.trade: 'Trade',
};

const List<String> _weekdayLong = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

DateTime? _parseDay(String iso) {
  final d = DateTime.tryParse('${iso}T00:00:00Z');
  return d == null ? null : DateTime.utc(d.year, d.month, d.day);
}

String _two(int n) => n.toString().padLeft(2, '0');

String _ymd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${_two(d.month)}-${_two(d.day)}';

String _wholeDays(double d) => d == d.roundToDouble() ? '${d.round()}' : '$d';

/// "Monday, Oct 26", "Week of Oct 26", or "Oct 6 – Oct 24". Raw input back
/// when it is not a date.
String reportPeriodWords(
  ReportKind kind,
  String periodStart,
  String periodEnd,
) {
  if (kind == ReportKind.daily) {
    final d = _parseDay(periodStart);
    return d != null
        ? '${_weekdayLong[d.weekday - 1]}, ${isoShort(periodStart)}'
        : periodStart;
  }
  // A one-day span renders as a single date, whatever the kind.
  if (periodStart == periodEnd) return isoDay(periodStart);
  if (kind == ReportKind.weekly) return 'Week of ${isoShort(periodStart)}';
  return '${isoShort(periodStart)} \u2013 ${isoShort(periodEnd)}';
}

/// Short period for list rows: one date for daily reports, a range otherwise.
String reportPeriodShort(
  ReportKind kind,
  String periodStart,
  String periodEnd,
) {
  if (kind == ReportKind.daily) return isoDay(periodStart);
  if (periodStart == periodEnd) return isoShort(periodStart);
  return '${isoShort(periodStart)} \u2013 ${isoShort(periodEnd)}';
}

class Figure {
  const Figure({
    required this.key,
    required this.label,
    required this.value,
    this.sub,
    required this.tone,
  });
  final String key;
  final String label;
  final String value;
  final String? sub;
  final Tone tone;
}

/// The figure strip for a report brief. Every figure with data is included;
/// an undefined figure is omitted rather than shown as zero. Trade reports
/// describe one position, so they show only the trade's own figures; the
/// day-level tallies below (trades closed, win rate, average R, heat) belong
/// to daily and weekly reports.
List<Figure> figureStrip(ReportFacts f) {
  final out = <Figure>[];
  if (f.pnl != null) {
    out.add(
      Figure(
        key: 'pnl',
        label: 'P&L',
        value: usdSigned(f.pnl!),
        sub: f.pnlPct != null ? pctSigned(f.pnlPct!) : null,
        tone: tone(f.pnl!),
      ),
    );
  }
  if (f.benchmarkPct != null) {
    final diff = (f.pnlPct ?? 0) - f.benchmarkPct!;
    out.add(
      Figure(
        key: 'spy',
        // SPY's own move; the caption carries the comparison, so the figure stays neutral.
        label: 'SPY',
        value: pctSigned(f.benchmarkPct!),
        sub: f.pnlPct != null
            ? diff.abs() < 0.005
                ? 'matched SPY'
                : diff > 0
                    ? 'beat SPY by ${pct(diff.abs())}'
                    : 'trailed SPY by ${pct(diff.abs())}'
            : 'same period',
        tone: Tone.flat,
      ),
    );
  }
  final trade = f.trade?.trade;
  if (trade != null) {
    return _tradeFigures(
      out,
      trade.rMultiple,
      trade.holdingDays,
    );
  }
  if (f.trades.isNotEmpty) {
    out.add(
      Figure(
        key: 'trades',
        label: 'Trades closed',
        value: '${f.trades.length}',
        sub: f.winRatePct != null ? '${pct(f.winRatePct!)} won' : null,
        tone: Tone.flat,
      ),
    );
  }
  if (f.winRatePct != null) {
    out.add(
      Figure(
        key: 'winrate',
        label: 'Win rate',
        value: pct(f.winRatePct!),
        tone: Tone.flat,
      ),
    );
  }
  if (f.avgR != null) {
    out.add(
      Figure(
        key: 'avgr',
        label: 'Average R',
        value:
            '${f.avgR! >= 0 ? '+' : '\u2212'}${f.avgR!.abs().toStringAsFixed(2)}R',
        sub: 'per plan',
        tone: tone(f.avgR!),
      ),
    );
  }
  if (f.heatPct != null) {
    out.add(
      Figure(
        key: 'heat',
        label: 'Heat',
        value: pct(f.heatPct!),
        sub: 'at risk to stops',
        tone: Tone.flat,
      ),
    );
  }
  return out;
}

/// The trade's own R multiple and holding period, appended after P&L and SPY
/// for a trade report.
List<Figure> _tradeFigures(
  List<Figure> out,
  double? rMultiple,
  double? holdingDays,
) {
  if (rMultiple != null) {
    out.add(
      Figure(
        key: 'r',
        label: 'R multiple',
        value:
            '${rMultiple >= 0 ? '+' : '\u2212'}${rMultiple.abs().toStringAsFixed(2)}R',
        tone: tone(rMultiple),
      ),
    );
  }
  if (holdingDays != null) {
    out.add(
      Figure(
        key: 'holding',
        label: 'Holding',
        value:
            '${_wholeDays(holdingDays)} day${holdingDays == 1 ? '' : 's'}',
        tone: Tone.flat,
      ),
    );
  }
  return out;
}

class PlanRow {
  const PlanRow({
    required this.label,
    required this.planned,
    required this.realized,
    this.fees,
  });
  final String label;
  final String planned;
  final String realized;

  /// Regulatory fees netted out of a realized P&L, dollars, when known and
  /// above zero.
  final double? fees;
}

/// Plan-versus-outcome table for a trade report. Planned cells read "—" when
/// the plan is missing.
List<PlanRow> planOutcomeRows(Report r) {
  final t = r.facts.trade;
  if (t == null) return [];
  final plan = t.plan;
  final tr = t.trade;
  final fees = tr.fees != null && tr.fees! > 0 ? tr.fees : null;
  if (plan == null) {
    // No plan on record (for example a Robinhood-history import): show only
    // outcomes known from the fill itself, and never label one a stop-out.
    final rows = <PlanRow>[
      PlanRow(
        label: 'Realized P&L',
        planned: '\u2014',
        realized:
            '${usdSigned(tr.pnl)}${tr.pnlPct != null ? ' (${pctSigned(tr.pnlPct!)})' : ''}',
        fees: fees,
      ),
      PlanRow(label: 'Exit price', planned: '\u2014', realized: usd(tr.exitPrice)),
    ];
    if (tr.holdingDays != null) {
      rows.add(
        PlanRow(
          label: 'Holding period',
          planned: '\u2014',
          realized: '${_wholeDays(tr.holdingDays!)} day${tr.holdingDays == 1 ? '' : 's'} held',
        ),
      );
    }
    return rows;
  }
  final won = tr.pnl >= 0;
  return [
    PlanRow(
      label: 'Target gain',
      planned: '+${pct(plan.expectedGainPct)}',
      realized:
          '${usdSigned(tr.pnl)}${tr.pnlPct != null ? ' (${pctSigned(tr.pnlPct!)})' : ''}',
      fees: fees,
    ),
    PlanRow(
      label: 'Loss to stop',
      planned: pct(plan.expectedLossPct),
      realized: tr.rMultiple != null
          ? '${tr.rMultiple! >= 0 ? '+' : '\u2212'}${tr.rMultiple!.abs().toStringAsFixed(1)}R'
          : '\u2014',
    ),
    PlanRow(
      label: 'Stated odds',
      planned: '${(plan.probabilityWin * 100).round()}%',
      realized: won ? 'Won' : 'Stopped out',
    ),
    PlanRow(
      label: 'Stop',
      planned: usd(plan.invalidationPrice),
      realized: 'Exited ${usd(tr.exitPrice)}',
    ),
    PlanRow(
      label: 'Time stop',
      planned: isoShort(plan.timeStopDate),
      realized: tr.holdingDays != null
          ? '${_wholeDays(tr.holdingDays!)} day${tr.holdingDays == 1 ? '' : 's'} held'
          : '\u2014',
    ),
  ];
}

/// Monday (UTC) of the week containing an ET date, as YYYY-MM-DD.
String? mondayOf(String iso) {
  final d = _parseDay(iso);
  if (d == null) return null;
  final back = ((d.weekday % 7) + 6) % 7;
  return _ymd(d.subtract(Duration(days: back)));
}

class ReportWeek {
  const ReportWeek({
    required this.key,
    required this.label,
    required this.items,
  });
  final String key;
  final String label;
  final List<ReportSummary> items;
}

/// Newest first, grouped by the week of the period start. Undated reports land
/// in one group at the end.
List<ReportWeek> groupReportsByWeek(List<ReportSummary> reports) {
  final order = <String, int>{};
  final groups = <String, List<ReportSummary>>{};
  for (final r in reports) {
    final key = mondayOf(r.periodStart) ?? 'undated';
    if (!groups.containsKey(key)) {
      groups[key] = [];
      order[key] = order.length;
    }
    groups[key]!.add(r);
  }
  final out = groups.entries
      .map(
        (e) => ReportWeek(
          key: e.key,
          label: e.key == 'undated'
              ? 'Undated'
              : 'Week of ${isoShort(e.key)}',
          items: List.of(e.value)
            ..sort((a, b) => b.at.compareTo(a.at)),
        ),
      )
      .toList()
    ..sort((a, b) {
      if (a.key == 'undated') return 1;
      if (b.key == 'undated') return -1;
      return b.key.compareTo(a.key);
    });
  return out;
}

/// One-line reading above the equity figure: "Up 1.00% vs SPY's +0.60% since Oct 26".
String? periodReading(ReportFacts f) {
  if (f.pnlPct == null) return null;
  final dir = f.pnlPct! >= 0 ? 'Up' : 'Down';
  final mine = pct(f.pnlPct!.abs());
  final since = 'since ${isoShort(f.periodStart)}';
  if (f.benchmarkPct == null) return '$dir $mine $since';
  return '$dir $mine vs SPY\'s ${pctSigned(f.benchmarkPct!)} $since';
}

class ReportToast {
  const ReportToast({required this.title, required this.body});
  final String title;
  final String body;
}

/// Toast copy for a newly published report.
ReportToast reportToast(ReportSummary r) {
  if (r.kind == ReportKind.daily) {
    return ReportToast(title: 'Daily report ready', body: r.headline);
  }
  if (r.kind == ReportKind.weekly) {
    return ReportToast(title: 'Weekly report ready', body: r.headline);
  }
  return ReportToast(
    title: 'Trade report · ${r.symbol ?? 'closed position'}',
    body: r.headline,
  );
}

class TradeMarkerDates {
  const TradeMarkerDates({this.entry, required this.exit, this.timeStop});

  /// Bar date of (or just after) the entry. Absent when the entry date is
  /// unknown.
  final String? entry;

  /// Bar date of (or just before) the exit.
  final String exit;

  /// Bar date marking the time stop, when it falls inside the bar range.
  final String? timeStop;

  @override
  bool operator ==(Object other) =>
      other is TradeMarkerDates &&
      other.entry == entry &&
      other.exit == exit &&
      other.timeStop == timeStop;

  @override
  int get hashCode => Object.hash(entry, exit, timeStop);

  @override
  String toString() =>
      'TradeMarkerDates(entry: $entry, exit: $exit, timeStop: $timeStop)';
}

/// Minutes offset of America/New_York behind UTC at [utc]: -240 (EDT) between
/// the second Sunday of March 07:00 UTC and the first Sunday of November
/// 06:00 UTC, else -300 (EST).
int _nyOffsetMinutes(DateTime utc) {
  DateTime firstSundayOf(int month) {
    final first = DateTime.utc(utc.year, month, 1);
    return DateTime.utc(utc.year, month, 1 + ((7 - first.weekday) % 7));
  }

  final dstStart = firstSundayOf(3).add(const Duration(days: 7, hours: 7));
  final dstEnd = firstSundayOf(11).add(const Duration(hours: 6));
  final inDst = !utc.isBefore(dstStart) && utc.isBefore(dstEnd);
  return inDst ? -240 : -300;
}

String _etDay(int ms) {
  final utc = DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
  final local = utc.add(Duration(minutes: _nyOffsetMinutes(utc)));
  return _ymd(local);
}

/// Resolves entry, exit and time-stop dates onto actual bar dates so the
/// price-path chart can mark them. Falls back to the first/last bar when the
/// stamp sits outside the range. With no entry stamp there is no entry marker:
/// guessing the first bar would point at a day the position may not have
/// existed.
TradeMarkerDates tradeMarkerDates(
  List<Bar> bars,
  int? openedAt,
  int closedAt, [
  String? timeStopDate,
]) {
  final first = bars.isNotEmpty ? bars[0].date : '';
  final last = bars.isNotEmpty ? bars[bars.length - 1].date : '';
  final entryDay = openedAt != null ? _etDay(openedAt) : null;
  final exitDay = _etDay(closedAt);
  String? entry;
  if (entryDay != null) {
    String? hit;
    for (final b in bars) {
      if (b.date.compareTo(entryDay) >= 0) {
        hit = b.date;
        break;
      }
    }
    entry = hit ?? first;
  }
  String? exit;
  for (var i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date.compareTo(exitDay) <= 0) {
      exit = bars[i].date;
      break;
    }
  }
  exit ??= last;
  String? timeStop;
  if (timeStopDate != null) {
    for (final b in bars) {
      if (b.date.compareTo(timeStopDate) >= 0) {
        timeStop = b.date;
        break;
      }
    }
  }
  return TradeMarkerDates(entry: entry, exit: exit, timeStop: timeStop);
}
