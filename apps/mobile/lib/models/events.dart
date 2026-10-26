import 'dart:convert';

import 'agent.dart';
import 'journal.dart';
import 'notes.dart';
import 'orders.dart';
import 'reports.dart';
import 'sim.dart';
import 'status.dart';

/// One server-sent event. `conversationId` is set for subagent transcripts and
/// absent for the lead agent. `simRunId` is set for events from a simulation
/// run and absent for the live account.
sealed class ServerEvent {
  const ServerEvent();

  /// Parses one SSE `data:` JSON line. Returns null for malformed JSON or an
  /// unknown `type`, and never throws.
  static ServerEvent? tryParse(String json) {
    final dynamic decoded;
    try {
      decoded = jsonDecode(json);
    } catch (_) {
      return null;
    }
    if (decoded is! Map<String, dynamic>) return null;
    try {
      final type = decoded['type'];
      switch (type) {
        case 'status':
          return StatusEvent(
            StatusResponse.fromJson(decoded['status'] as Map<String, dynamic>),
          );
        case 'message':
          return MessageEvent(
            ChatMessage.fromJson(decoded['message'] as Map<String, dynamic>),
            conversationId: decoded['conversationId'] as String?,
            simRunId: decoded['simRunId'] as String?,
          );
        case 'delta':
          return DeltaEvent(
            decoded['text'] as String,
            conversationId: decoded['conversationId'] as String?,
            simRunId: decoded['simRunId'] as String?,
          );
        case 'subagent':
          return SubagentEvent(
            SubagentRun.fromJson(decoded['run'] as Map<String, dynamic>),
            simRunId: decoded['simRunId'] as String?,
          );
        case 'calls':
          final callsJson = decoded['calls'] as List;
          return CallsEvent(
            callsJson
                .map((c) => ToolCallSummary.fromJson(c as Map<String, dynamic>))
                .toList(),
            conversationId: decoded['conversationId'] as String?,
            simRunId: decoded['simRunId'] as String?,
          );
        case 'journal':
          return JournalEvent(
            JournalEntry.fromJson(decoded['entry'] as Map<String, dynamic>),
            simRunId: decoded['simRunId'] as String?,
          );
        case 'order':
          return OrderEvent(
            OrderRecord.fromJson(decoded['order'] as Map<String, dynamic>),
            simRunId: decoded['simRunId'] as String?,
          );
        case 'note':
          return NoteEvent(
            NoteFile.fromJson(decoded['note'] as Map<String, dynamic>),
            simRunId: decoded['simRunId'] as String?,
          );
        case 'sim':
          return SimEvent(
            SimRun.fromJson(decoded['run'] as Map<String, dynamic>),
          );
        case 'report':
          return ReportEvent(
            ReportSummary.fromJson(decoded['report'] as Map<String, dynamic>),
            simRunId: decoded['simRunId'] as String?,
          );
        case 'sim_suite':
          return SimSuiteEvent(
            SimSuite.fromJson(decoded['suite'] as Map<String, dynamic>),
            simRunId: decoded['simRunId'] as String?,
          );
        default:
          return null;
      }
    } catch (_) {
      return null;
    }
  }
}

final class StatusEvent extends ServerEvent {
  const StatusEvent(this.status);

  final StatusResponse status;
}

final class MessageEvent extends ServerEvent {
  const MessageEvent(this.message, {this.conversationId, this.simRunId});

  final ChatMessage message;
  final String? conversationId;
  final String? simRunId;
}

/// Streaming assistant text for the in-flight turn; replaced by the committed `message`.
final class DeltaEvent extends ServerEvent {
  const DeltaEvent(this.text, {this.conversationId, this.simRunId});

  final String text;
  final String? conversationId;
  final String? simRunId;
}

final class SubagentEvent extends ServerEvent {
  const SubagentEvent(this.run, {this.simRunId});

  final SubagentRun run;
  final String? simRunId;
}

/// Live nested calls of the running Code Mode script, replaced by the committed tool message.
final class CallsEvent extends ServerEvent {
  const CallsEvent(this.calls, {this.conversationId, this.simRunId});

  final List<ToolCallSummary> calls;
  final String? conversationId;
  final String? simRunId;
}

final class JournalEvent extends ServerEvent {
  const JournalEvent(this.entry, {this.simRunId});

  final JournalEntry entry;
  final String? simRunId;
}

final class OrderEvent extends ServerEvent {
  const OrderEvent(this.order, {this.simRunId});

  final OrderRecord order;
  final String? simRunId;
}

final class NoteEvent extends ServerEvent {
  const NoteEvent(this.note, {this.simRunId});

  final NoteFile note;
  final String? simRunId;
}

final class SimEvent extends ServerEvent {
  const SimEvent(this.run);

  final SimRun run;
}

final class ReportEvent extends ServerEvent {
  const ReportEvent(this.report, {this.simRunId});

  final ReportSummary report;
  final String? simRunId;
}

final class SimSuiteEvent extends ServerEvent {
  const SimSuiteEvent(this.suite, {this.simRunId});

  final SimSuite suite;
  final String? simRunId;
}
