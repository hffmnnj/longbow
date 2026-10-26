import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/domain/reports_calc.dart';
import 'package:longbow/models/models.dart';

ReportSummary _summary({
  String id = 'r',
  ReportKind kind = ReportKind.daily,
  int at = 1,
  String? symbol,
  String periodStart = '2026-10-26',
  String periodEnd = '2026-10-26',
  String headline = 'Flat tape',
}) =>
    ReportSummary(
      id: id,
      kind: kind,
      at: at,
      symbol: symbol,
      periodStart: periodStart,
      periodEnd: periodEnd,
      headline: headline,
    );

ReportFacts _facts({
  String periodStart = '2026-10-26',
  String periodEnd = '2026-10-26',
  double? pnl,
  double? pnlPct,
  double? benchmarkPct,
  List<ClosedTrade> trades = const [],
  double realizedPnl = 0,
  double? winRatePct,
  double? avgR,
  double? heatPct,
  ReportTradeFacts? trade,
}) =>
    ReportFacts(
      periodStart: periodStart,
      periodEnd: periodEnd,
      equityCurve: const [],
      trades: trades,
      realizedPnl: realizedPnl,
      orders: const ReportOrderCounts(
        submitted: 0,
        filled: 0,
        rejected: 0,
        cancelled: 0,
        failed: 0,
      ),
      positions: const [],
      decisions: const [],
      pnl: pnl,
      pnlPct: pnlPct,
      benchmarkPct: benchmarkPct,
      winRatePct: winRatePct,
      avgR: avgR,
      heatPct: heatPct,
      trade: trade,
    );

Report _tradeReport({ClosedTrade? trade, ReportTradePlan? plan}) => Report(
      id: 'r',
      kind: ReportKind.trade,
      symbol: 'NVDA',
      at: 1,
      periodStart: '2026-10-06',
      periodEnd: '2026-10-24',
      headline: 'Stopped out',
      narrative: const ReportNarrative(
        kind: ReportKind.trade,
        headline: 'Stopped out',
        summary: 's',
        sections: [],
        lessons: [],
        nextSteps: [],
      ),
      facts: _facts(
        periodStart: '2026-10-06',
        periodEnd: '2026-10-24',
        trade: trade == null
            ? null
            : ReportTradeFacts(trade: trade, plan: plan, bars: const []),
      ),
    );

void main() {
  group('reportPeriodWords', () {
    test('names the weekday for a daily report', () {
      expect(reportPeriodWords(ReportKind.daily, '2026-10-26', '2026-10-26'),
          'Monday, Oct 26');
    });

    test('names the week for a weekly report', () {
      expect(
          reportPeriodWords(ReportKind.weekly, '2026-10-26', '2026-10-30'),
          'Week of Oct 26');
    });

    test('spans the entry to the exit for a trade report', () {
      expect(reportPeriodWords(ReportKind.trade, '2026-10-06', '2026-10-24'),
          'Oct 6 \u2013 Oct 24');
    });

    test('renders a one-day span as a single date for every kind', () {
      expect(reportPeriodWords(ReportKind.trade, '2026-09-28', '2026-09-28'),
          'Mon, Sep 28');
      expect(reportPeriodWords(ReportKind.weekly, '2026-10-26', '2026-10-26'),
          'Mon, Oct 26');
      expect(
          reportPeriodWords(ReportKind.daily, '2026-10-26', '2026-10-26'),
          'Monday, Oct 26');
      expect(reportPeriodShort(ReportKind.trade, '2026-09-28', '2026-09-28'),
          'Sep 28');
      expect(reportPeriodShort(ReportKind.weekly, '2026-10-26', '2026-10-26'),
          'Oct 26');
    });

    test('falls back to the raw input when the date is not parseable', () {
      expect(reportPeriodWords(ReportKind.daily, 'soon', 'soon'), 'soon');
      expect(reportPeriodShort(ReportKind.daily, 'soon', 'soon'), 'soon');
    });
  });

  group('figureStrip', () {
    test('omits undefined figures rather than showing zero', () {
      expect(figureStrip(_facts()), isEmpty);
    });

    test('spells out the difference to SPY in both directions', () {
      final beat =
          figureStrip(_facts(pnl: 100, pnlPct: 0.4, benchmarkPct: 0.1));
      expect(beat.firstWhere((f) => f.key == 'pnl').sub, '+0.40%');
      expect(beat.firstWhere((f) => f.key == 'spy').sub, 'beat SPY by 0.30%');
      final trailed =
          figureStrip(_facts(pnl: -50, pnlPct: -0.2, benchmarkPct: 0.1));
      expect(trailed.firstWhere((f) => f.key == 'spy').sub,
          'trailed SPY by 0.30%');
      final matched =
          figureStrip(_facts(pnl: 1, pnlPct: 0.1, benchmarkPct: 0.101));
      expect(
          matched.firstWhere((f) => f.key == 'spy').sub, 'matched SPY');
    });

    test('keeps trades, win rate, R and heat when present', () {
      final figs = figureStrip(_facts(
        trades: const [
          ClosedTrade(
              symbol: 'MSFT',
              closedAt: 1,
              quantity: 1,
              exitPrice: 2,
              pnl: 3,
              source: TradeSource.harness),
          ClosedTrade(
              symbol: 'XLK',
              closedAt: 2,
              quantity: 1,
              exitPrice: 2,
              pnl: -1,
              source: TradeSource.harness),
        ],
        winRatePct: 50,
        avgR: 1.2,
        heatPct: 0.62,
      ));
      expect(figs.map((f) => f.key), ['trades', 'winrate', 'avgr', 'heat']);
      expect(figs.firstWhere((f) => f.key == 'trades').value, '2');
      expect(figs.firstWhere((f) => f.key == 'trades').sub, '50.00% won');
      expect(figs.firstWhere((f) => f.key == 'avgr').value, '+1.20R');
    });

    test('shows only the trade figures on a trade report', () {
      final figs = figureStrip(_facts(
        pnl: -6.73,
        pnlPct: -2.5,
        benchmarkPct: -0.74,
        trades: const [
          ClosedTrade(
              symbol: 'VRT',
              closedAt: 1,
              quantity: 1,
              exitPrice: 2,
              pnl: -6.73,
              source: TradeSource.robinhood),
          ClosedTrade(
              symbol: 'CEG',
              closedAt: 2,
              quantity: 1,
              exitPrice: 2,
              pnl: -8.21,
              source: TradeSource.robinhood),
        ],
        realizedPnl: -14.94,
        winRatePct: 0,
        avgR: -0.5,
        heatPct: 2.14,
        trade: const ReportTradeFacts(
          trade: ClosedTrade(
            symbol: 'VRT',
            closedAt: 1,
            quantity: 1,
            exitPrice: 2,
            pnl: -6.73,
            rMultiple: -1,
            holdingDays: 6,
            source: TradeSource.robinhood,
          ),
          bars: [],
        ),
      ));
      expect(figs.map((f) => f.key), ['pnl', 'spy', 'r', 'holding']);
      final pnlFig = figs.firstWhere((f) => f.key == 'pnl');
      expect(pnlFig.value, '\u2212\$6.73');
      expect(pnlFig.sub, '\u22122.50%');
      final rFig = figs.firstWhere((f) => f.key == 'r');
      expect(rFig.value, '\u22121.00R');
      expect(rFig.label, 'R multiple');
      expect(
          figs.firstWhere((f) => f.key == 'holding').value, '6 days');
    });

    test('omits the trade R and holding figures when the plan is unknown', () {
      final figs = figureStrip(_facts(
        pnl: -6.73,
        benchmarkPct: -0.74,
        winRatePct: 0,
        heatPct: 2.14,
        trade: const ReportTradeFacts(
          trade: ClosedTrade(
            symbol: 'VRT',
            closedAt: 1,
            quantity: 1,
            exitPrice: 2,
            pnl: -6.73,
            source: TradeSource.robinhood,
          ),
          bars: [],
        ),
      ));
      expect(figs.map((f) => f.key), ['pnl', 'spy']);
    });
  });

  group('planOutcomeRows', () {
    test('returns no rows when the report carries no trade section', () {
      expect(planOutcomeRows(_tradeReport()), isEmpty);
    });

    test('returns the five plan-versus-outcome rows for a planned trade', () {
      final rows = planOutcomeRows(_tradeReport(
        trade: const ClosedTrade(
          symbol: 'NVDA',
          closedAt: 2,
          quantity: 12,
          entryPrice: 118.4,
          exitPrice: 111.6,
          pnl: -81.6,
          pnlPct: -5.74,
          rMultiple: -1,
          holdingDays: 6,
          source: TradeSource.harness,
        ),
        plan: const ReportTradePlan(
          thesis: 't',
          invalidationPrice: 112,
          timeStopDate: '2026-11-13',
          probabilityWin: 0.64,
          expectedGainPct: 8.2,
          expectedLossPct: 5.4,
        ),
      ));
      expect(rows.map((x) => x.label),
          ['Target gain', 'Loss to stop', 'Stated odds', 'Stop', 'Time stop']);
      expect(rows[0].planned, '+8.20%');
      expect(rows[0].realized, '\u2212\$81.60 (\u22125.74%)');
      expect(rows[1].planned, '5.40%');
      expect(rows[1].realized, '\u22121.0R');
      expect(rows[2].planned, '64%');
      expect(rows[2].realized, 'Stopped out');
      expect(rows[3].planned, '\$112.00');
      expect(rows[3].realized, 'Exited \$111.60');
      expect(rows[4].planned, 'Nov 13');
      expect(rows[4].realized, '6 days held');
    });

    test('shows only known outcomes with no stop-out claim when unplanned', () {
      final rows = planOutcomeRows(_tradeReport(
        trade: const ClosedTrade(
          symbol: 'XLE',
          closedAt: 2,
          quantity: 25,
          entryPrice: 92.1,
          exitPrice: 91.62,
          pnl: -12,
          source: TradeSource.robinhood,
        ),
      ));
      expect(rows.map((x) => x.label), ['Realized P&L', 'Exit price']);
      expect(rows[0].planned, '\u2014');
      expect(rows[0].realized, '\u2212\$12.00');
      expect(rows[1].planned, '\u2014');
      expect(rows[1].realized, '\$91.62');
      expect(rows.any((x) => RegExp('stop', caseSensitive: false).hasMatch(x.realized)),
          isFalse);
    });

    test('adds the holding period when it is known and there is no plan', () {
      final rows = planOutcomeRows(_tradeReport(
        trade: const ClosedTrade(
          symbol: 'VRT',
          closedAt: 2,
          quantity: 1,
          exitPrice: 253.25,
          pnl: -6.73,
          holdingDays: 6,
          source: TradeSource.robinhood,
        ),
      ));
      expect(rows.map((x) => x.label),
          ['Realized P&L', 'Exit price', 'Holding period']);
      expect(rows[2].planned, '\u2014');
      expect(rows[2].realized, '6 days held');
    });

    test('carries regulatory fees on the realized row only above zero', () {
      final withFees = planOutcomeRows(_tradeReport(
        trade: const ClosedTrade(
          symbol: 'NVDA',
          closedAt: 2,
          quantity: 12,
          exitPrice: 111.6,
          pnl: -81.6,
          fees: 0.04,
          source: TradeSource.harness,
        ),
      ));
      expect(withFees[0].label, 'Realized P&L');
      expect(withFees[0].fees, 0.04);
      final zeroFees = planOutcomeRows(_tradeReport(
        trade: const ClosedTrade(
          symbol: 'NVDA',
          closedAt: 2,
          quantity: 12,
          exitPrice: 111.6,
          pnl: -81.6,
          fees: 0,
          source: TradeSource.harness,
        ),
      ));
      expect(zeroFees[0].fees, isNull);
      final noFees = planOutcomeRows(_tradeReport(
        trade: const ClosedTrade(
          symbol: 'NVDA',
          closedAt: 2,
          quantity: 12,
          exitPrice: 111.6,
          pnl: -81.6,
          source: TradeSource.harness,
        ),
      ));
      expect(noFees[0].fees, isNull);
    });
  });

  group('groupReportsByWeek', () {
    test('groups by the week of the period start, newest week first', () {
      final groups = groupReportsByWeek([
        _summary(id: 'b', at: 2, periodStart: '2026-10-20', periodEnd: '2026-10-20'),
        _summary(
            id: 'a',
            at: 3,
            kind: ReportKind.weekly,
            periodStart: '2026-10-26',
            periodEnd: '2026-10-30'),
        _summary(
            id: 'c',
            at: 1,
            kind: ReportKind.trade,
            symbol: 'NVDA',
            periodStart: '2026-10-27',
            periodEnd: '2026-11-02'),
      ]);
      expect(groups.map((g) => g.label), ['Week of Oct 26', 'Week of Oct 19']);
      expect(groups[0].items.map((i) => i.id), ['a', 'c']);
    });

    test('collects undated reports in a group at the end', () {
      final groups = groupReportsByWeek(
          [_summary(id: 'x', periodStart: 'never', periodEnd: 'never')]);
      expect(groups, hasLength(1));
      expect(groups[0].label, 'Undated');
    });
  });

  group('periodReading', () {
    test('reads the period move against SPY', () {
      expect(
        periodReading(
            _facts(pnlPct: 1, benchmarkPct: 0.6, periodStart: '2026-10-26')),
        'Up 1.00% vs SPY\'s +0.60% since Oct 26',
      );
      expect(
        periodReading(_facts(pnlPct: -0.2, periodStart: '2026-10-26')),
        'Down 0.20% since Oct 26',
      );
      expect(periodReading(_facts()), isNull);
    });
  });

  group('reportToast', () {
    test('names the kind, and the symbol for trade reports', () {
      expect(reportToast(_summary(kind: ReportKind.daily, headline: 'h')).title,
          'Daily report ready');
      expect(
          reportToast(_summary(kind: ReportKind.weekly, headline: 'h')).title,
          'Weekly report ready');
      expect(
          reportToast(_summary(
                  kind: ReportKind.trade, symbol: 'NVDA', headline: 'h'))
              .title,
          'Trade report \u00b7 NVDA');
    });
  });

  group('tradeMarkerDates', () {
    const bars = [
      Bar(date: '2026-10-01', open: 1, high: 1, low: 1, close: 1, volume: 1),
      Bar(date: '2026-10-02', open: 1, high: 1, low: 1, close: 1, volume: 1),
      Bar(date: '2026-10-05', open: 1, high: 1, low: 1, close: 1, volume: 1),
      Bar(date: '2026-10-06', open: 1, high: 1, low: 1, close: 1, volume: 1),
    ];
    int ms(String iso) => DateTime.parse('${iso}T14:00:00-04:00').millisecondsSinceEpoch;

    test('resolves entry, exit and the time stop onto bar dates', () {
      expect(
        tradeMarkerDates(bars, ms('2026-10-01'), ms('2026-10-06'), '2026-10-05'),
        const TradeMarkerDates(
            entry: '2026-10-01', exit: '2026-10-06', timeStop: '2026-10-05'),
      );
    });

    test('clamps stamps outside the bar range and drops a past-the-end stop', () {
      expect(
        tradeMarkerDates(bars, ms('2026-09-20'), ms('2026-11-01'), '2026-11-01'),
        const TradeMarkerDates(
            entry: '2026-10-01', exit: '2026-10-06', timeStop: null),
      );
    });

    test('omits the entry marker when the entry date is unknown', () {
      expect(
        tradeMarkerDates(bars, null, ms('2026-10-06')),
        const TradeMarkerDates(
            entry: null, exit: '2026-10-06', timeStop: null),
      );
    });
  });
}
