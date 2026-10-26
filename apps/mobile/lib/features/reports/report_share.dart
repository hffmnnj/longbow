import 'package:longbow/domain/reports_calc.dart'
    show figureStrip, kindLabel, planOutcomeRows, reportPeriodWords;
import 'package:longbow/models/models.dart';

/// Plain-text rendering of a [Report] for the Share sheet: headline, kind and
/// period, grade, the figure strip, summary, plan versus outcome for trades,
/// lessons and next steps. Pure so tests can assert on it.
String reportShareText(Report r) {
  final buf = StringBuffer()..writeln(r.headline);
  buf.writeln(
    '${kindLabel[r.kind] ?? r.kind.name} · '
    '${reportPeriodWords(r.kind, r.periodStart, r.periodEnd)}',
  );
  if (r.grade != null) {
    final letter = r.grade!.name.toUpperCase();
    final reason = r.narrative.gradeReason;
    buf.writeln('Grade $letter${reason == null ? '' : ' — $reason'}');
  }
  final figs = figureStrip(r.facts);
  if (figs.isNotEmpty) {
    buf.writeln();
    for (final f in figs) {
      buf.writeln('${f.label}: ${f.value}${f.sub == null ? '' : ' (${f.sub})'}');
    }
  }
  buf
    ..writeln()
    ..writeln(r.narrative.summary);
  final plan = planOutcomeRows(r);
  if (plan.isNotEmpty) {
    buf.writeln();
    buf.writeln('Plan versus outcome');
    for (final row in plan) {
      buf.writeln(
        '${row.label}: planned ${row.planned}, realized ${row.realized}',
      );
    }
  }
  if (r.narrative.lessons.isNotEmpty) {
    buf.writeln();
    buf.writeln('Lessons');
    for (final l in r.narrative.lessons) {
      buf.writeln('- $l');
    }
  }
  if (r.narrative.nextSteps.isNotEmpty) {
    buf.writeln();
    buf.writeln('Next');
    for (final n in r.narrative.nextSteps) {
      buf.writeln('- $n');
    }
  }
  return buf.toString().trimRight();
}
