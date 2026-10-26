import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/reports/report_share.dart';
import 'package:longbow/models/models.dart';

Map<String, dynamic> _fixtureMap(String name) =>
    jsonDecode(File('test/fixtures/$name.json').readAsStringSync())
        as Map<String, dynamic>;

Report _dailyReport() => Report(
  id: 'daily-1',
  kind: ReportKind.daily,
  at: 1792978653000,
  periodStart: '2026-10-26',
  periodEnd: '2026-10-26',
  headline: 'Quiet day: account flat against SPY',
  grade: ReportGrade.b,
  pnl: 12.5,
  pnlPct: 0.1,
  narrative: const ReportNarrative(
    kind: ReportKind.daily,
    headline: 'Quiet day: account flat against SPY',
    summary: 'A calm session summary.',
    grade: ReportGrade.b,
    gradeReason: 'Sized well, no churn.',
    sections: [ReportSection(title: 'Market', body: 'Markets drifted.')],
    lessons: ['Patience paid.'],
    nextSteps: ['Watch NVDA.'],
  ),
  facts: ReportFacts(
    periodStart: '2026-10-26',
    periodEnd: '2026-10-26',
    pnl: 12.5,
    pnlPct: 0.1,
    benchmarkPct: 0.05,
    equityCurve: const [
      HoldingsReplayPoint(date: '2026-10-24', value: 11900),
      HoldingsReplayPoint(date: '2026-10-25', value: 11905),
    ],
    trades: const [],
    realizedPnl: 0,
    orders: const ReportOrderCounts(
      submitted: 1,
      filled: 1,
      rejected: 0,
      cancelled: 0,
      failed: 0,
    ),
    positions: const [],
    decisions: const [],
  ),
);

void main() {
  group('reportShareText', () {
    test('trade report carries grade, figures, plan, lessons and next steps',
        () {
      final report = Report.fromJson(_fixtureMap('report_daily'));
      final text = reportShareText(report);

      expect(text, contains(report.headline));
      expect(text, contains('Trade'));
      expect(text, contains('Grade C'));
      expect(text, contains('Provisional C:'));
      expect(text, contains('P&L'));
      expect(text, contains('SPY'));
      expect(text, contains('Plan versus outcome'));
      expect(text, contains('Realized P&L'));
      expect(text, contains('Grade the decision process'));
      expect(text, contains('Record the rationale'));
    });

    test('daily report omits the plan table but keeps figures and lessons',
        () {
      final text = reportShareText(_dailyReport());

      expect(text, contains('Quiet day: account flat against SPY'));
      expect(text, contains('Grade B'));
      expect(text, contains('P&L'));
      expect(text, contains('A calm session summary.'));
      expect(text, contains('Patience paid.'));
      expect(text, contains('Watch NVDA.'));
      expect(text, isNot(contains('Plan versus outcome')));
    });
  });
}
