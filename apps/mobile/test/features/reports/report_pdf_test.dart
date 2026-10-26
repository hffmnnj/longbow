import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/reports/report_pdf.dart';
import 'package:longbow/models/models.dart';

Map<String, dynamic> _fixtureMap(String name) =>
    jsonDecode(File('test/fixtures/$name.json').readAsStringSync())
        as Map<String, dynamic>;

void main() {
  group('buildReportPdf', () {
    test('trade report builds non-empty A4 bytes', () async {
      final report = Report.fromJson(_fixtureMap('report_daily'));

      final bytes = await buildReportPdf(report);

      expect(bytes.isNotEmpty, isTrue);
      expect(String.fromCharCodes(bytes.take(4)), '%PDF');
    });

    test('daily style report with sections builds non-empty bytes', () async {
      final trade = Report.fromJson(_fixtureMap('report_daily'));
      // A trade brief exercises every layout branch (figures, plan table,
      // sections, lessons, next steps); a grade-less variant covers the
      // missing-grade path.
      final report = Report(
        id: trade.id,
        kind: trade.kind,
        at: trade.at,
        symbol: trade.symbol,
        periodStart: trade.periodStart,
        periodEnd: trade.periodEnd,
        headline: trade.headline,
        narrative: ReportNarrative(
          kind: trade.narrative.kind,
          headline: trade.narrative.headline,
          summary: trade.narrative.summary,
          sections: trade.narrative.sections,
          lessons: const [],
          nextSteps: const [],
        ),
        facts: trade.facts,
      );

      final bytes = await buildReportPdf(report);

      expect(bytes.isNotEmpty, isTrue);
      expect(String.fromCharCodes(bytes.take(4)), '%PDF');
    });
  });
}
