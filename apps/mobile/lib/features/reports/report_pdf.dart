import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'package:longbow/domain/reports_calc.dart'
    show figureStrip, kindLabel, planOutcomeRows, reportPeriodWords;
import 'package:longbow/models/models.dart';

/// The bundled PDF base font only covers WinAnsi: the true minus (U+2212 the
/// app uses for money) and arrows would render as gaps, so swap them for
/// ASCII before laying out text.
String _pdfText(String s) =>
    s.replaceAll('\u2212', '-').replaceAll('\u2192', '->');

pw.Widget _gap(double h) => pw.SizedBox(height: h);

pw.Widget _heading(String text, {double size = 20}) => pw.Text(
  _pdfText(text),
  style: pw.TextStyle(fontSize: size, fontWeight: pw.FontWeight.bold),
);

/// Builds a simple, clean A4 brief for [report]: headline, grade, summary,
/// the figure strip, plan versus outcome for trades, sections, lessons and
/// next steps. Pure bytes so a unit test can assert they build.
Future<Uint8List> buildReportPdf(Report report) async {
  final r = report;
  final doc = pw.Document();
  final figs = figureStrip(r.facts);
  final plan = planOutcomeRows(r);
  doc.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(48),
      build:
          (pw.Context context) => [
            _heading(r.headline),
            _gap(4),
            pw.Text(
              _pdfText(
                '${kindLabel[r.kind] ?? r.kind.name} report · '
                '${reportPeriodWords(r.kind, r.periodStart, r.periodEnd)}'
                '${r.symbol == null ? '' : ' · ${r.symbol}'}',
              ),
              style: const pw.TextStyle(fontSize: 11, color: PdfColors.grey700),
            ),
            if (r.grade != null) ...[
              _gap(12),
              pw.Text(
                _pdfText(
                  'Grade ${r.grade!.name.toUpperCase()}'
                  '${r.narrative.gradeReason == null ? '' : ' — ${r.narrative.gradeReason}'}',
                ),
                style: pw.TextStyle(
                  fontSize: 13,
                  fontWeight: pw.FontWeight.bold,
                ),
              ),
            ],
            _gap(12),
            pw.Text(_pdfText(r.narrative.summary)),
            if (figs.isNotEmpty) ...[
              _gap(12),
              _heading('Figures', size: 14),
              _gap(6),
              pw.Table(
                border: pw.TableBorder.all(color: PdfColors.grey400),
                children: [
                  for (final f in figs)
                    pw.TableRow(
                      children: [
                        pw.Padding(
                          padding: const pw.EdgeInsets.all(6),
                          child: pw.Text(_pdfText(f.label)),
                        ),
                        pw.Padding(
                          padding: const pw.EdgeInsets.all(6),
                          child: pw.Text(
                            _pdfText(
                              '${f.value}${f.sub == null ? '' : ' (${f.sub})'}',
                            ),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ],
            if (plan.isNotEmpty) ...[
              _gap(12),
              _heading('Plan versus outcome', size: 14),
              _gap(6),
              pw.Table(
                border: pw.TableBorder.all(color: PdfColors.grey400),
                children: [
                  pw.TableRow(
                    children:
                        ['Measure', 'Plan', 'Outcome']
                            .map(
                              (h) => pw.Padding(
                                padding: const pw.EdgeInsets.all(6),
                                child: pw.Text(
                                  h,
                                  style: pw.TextStyle(
                                    fontWeight: pw.FontWeight.bold,
                                  ),
                                ),
                              ),
                            )
                            .toList(),
                  ),
                  for (final row in plan)
                    pw.TableRow(
                      children:
                          [row.label, row.planned, row.realized]
                              .map(
                                (c) => pw.Padding(
                                  padding: const pw.EdgeInsets.all(6),
                                  child: pw.Text(_pdfText(c)),
                                ),
                              )
                              .toList(),
                    ),
                ],
              ),
            ],
            for (final s in r.narrative.sections) ...[
              _gap(12),
              _heading(s.title, size: 14),
              _gap(6),
              pw.Text(_pdfText(s.body)),
            ],
            if (r.narrative.lessons.isNotEmpty) ...[
              _gap(12),
              _heading('Lessons', size: 14),
              _gap(6),
              for (final l in r.narrative.lessons)
                pw.Padding(
                  padding: const pw.EdgeInsets.only(bottom: 4),
                  child: pw.Text('- ${_pdfText(l)}'),
                ),
            ],
            if (r.narrative.nextSteps.isNotEmpty) ...[
              _gap(12),
              _heading('Next', size: 14),
              _gap(6),
              for (final n in r.narrative.nextSteps)
                pw.Padding(
                  padding: const pw.EdgeInsets.only(bottom: 4),
                  child: pw.Text('- ${_pdfText(n)}'),
                ),
            ],
          ],
    ),
  );
  return doc.save();
}
