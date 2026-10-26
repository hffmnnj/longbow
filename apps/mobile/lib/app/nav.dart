import 'package:flutter/material.dart';

import '../features/feed/order_sheet.dart';
import '../features/feed/transcript_page.dart';
import '../features/history/doc_page.dart';
import '../features/lab/run_page.dart';
import '../features/lab/suite_page.dart';
import '../features/reports/report_page.dart';
import '../features/settings/settings_sheet.dart';
import '../features/symbol/symbol_page.dart';

/// Navigation entry points every feature uses to open a detail screen.
/// Detail screens push full-screen routes; order detail and settings are modal
/// sheets. Features call these functions and never construct each other's pages.
abstract final class AppNav {
  static Future<void> _push(BuildContext context, Widget page) =>
      Navigator.of(context).push<void>(MaterialPageRoute<void>(builder: (_) => page));

  static Future<void> symbol(BuildContext context, String symbol) =>
      _push(context, SymbolPage(symbol: symbol.toUpperCase()));

  static Future<void> report(BuildContext context, String id) =>
      _push(context, ReportPage(id: id));

  static Future<void> order(BuildContext context, String id) => showOrderSheet(context, id);

  /// Subagent transcript for a live or simulation conversation id.
  static Future<void> transcript(BuildContext context, String conversationId, {String? simRunId}) =>
      _push(context, TranscriptPage(conversationId: conversationId, simRunId: simRunId));

  static Future<void> note(BuildContext context, String path) =>
      _push(context, DocPage(kind: DocKind.note, id: path));

  static Future<void> skill(BuildContext context, String name) =>
      _push(context, DocPage(kind: DocKind.skill, id: name));

  static Future<void> run(BuildContext context, String runId) =>
      _push(context, RunPage(runId: runId));

  static Future<void> suite(BuildContext context, String suiteId) =>
      _push(context, SuitePage(suiteId: suiteId));

  static Future<void> settings(BuildContext context) => showSettingsSheet(context);
}
