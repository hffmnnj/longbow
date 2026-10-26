import 'package:flutter/widgets.dart';
import 'package:longbow/core/core.dart' show ToastAction, showToast;
import 'package:longbow/core/core.dart' as core show ToastTone;
import 'package:longbow/data/data.dart' show ToastEvent, ToastTone;

/// Shows a store [ToastEvent] as a snack bar. A toast that carries a report id
/// gets its action (Open by default) wired to [onOpenReport].
void showToastEvent(BuildContext context, ToastEvent event, {required void Function(String reportId) onOpenReport}) {
  final tone = switch (event.tone) {
    ToastTone.success => core.ToastTone.success,
    ToastTone.error => core.ToastTone.error,
    ToastTone.info => core.ToastTone.info,
  };
  final message = event.body.isEmpty ? event.title : '${event.title}\n${event.body}';
  final reportId = event.reportId;
  showToast(
    context,
    message,
    tone: tone,
    action: reportId == null ? null : ToastAction(event.actionLabel ?? 'Open', () => onOpenReport(reportId)),
  );
}
