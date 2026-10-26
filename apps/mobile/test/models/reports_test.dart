import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('reports_parsesSummaryList', () {
    final list =
        jsonDecode(File('test/fixtures/reports.json').readAsStringSync())
            as List;
    final summaries = list
        .map((r) => ReportSummary.fromJson(r as Map<String, dynamic>))
        .toList();

    expect(summaries, hasLength(1));
    expect(summaries.single.kind, ReportKind.trade);
    expect(summaries.single.symbol, 'VRT');
    expect(summaries.single.grade, ReportGrade.c);
    expect(summaries.single.pnl, closeTo(-53.84, 1e-9));
  });

  test('reports_parsesFullTradeReport', () {
    final json =
        jsonDecode(File('test/fixtures/report_daily.json').readAsStringSync())
            as Map<String, dynamic>;
    final report = Report.fromJson(json);

    expect(report.narrative.headline, report.headline);
    expect(report.narrative.kind, ReportKind.trade);
    expect(report.narrative.sections, hasLength(1));
    expect(report.narrative.lessons, hasLength(1));
    expect(report.narrative.nextSteps, hasLength(1));
    expect(report.facts.trade, isNotNull);
    expect(report.facts.trade!.trade.symbol, 'VRT');
    expect(report.facts.trade!.bars, hasLength(26));
    expect(report.facts.orders.submitted, 0);
  });
}
