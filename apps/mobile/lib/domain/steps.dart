// Dart port of `apps/web/src/lib/steps.ts`. Pure Dart: no Flutter imports.
import 'package:longbow/models/models.dart';

import 'tool_meta.dart';

/// True while a script-nested tool call is still running: no duration yet and
/// no error.
bool isRunning(ToolCallSummary c) =>
    c.durationMs == null && c.isError != true;

/// Match a step's delegate calls, in order, to subagent runs of the same role
/// that started inside the step's window. Returns one run (or null) per
/// delegate call.
List<SubagentRun?> matchRuns(
  List<ToolCallSummary> calls,
  List<SubagentRun> runs,
  int from,
  int to,
) {
  const slack = 5000;
  final pool = runs
      .where((r) => r.startedAt >= from - slack && r.startedAt <= to + slack)
      .toList()
    ..sort((a, b) => a.startedAt.compareTo(b.startedAt));
  final used = <String>{};
  return calls.map((c) {
    if (!c.name.endsWith('delegate')) return null;
    final role = delegateRole(c);
    SubagentRun? hit;
    for (final r in pool) {
      if (!used.contains(r.id) && (role == null || r.role == role)) {
        hit = r;
        break;
      }
    }
    if (hit != null) used.add(hit.id);
    return hit;
  }).toList();
}

const Map<CycleKind, String> _cycleLabels = {
  CycleKind.preOpen: 'Pre-open',
  CycleKind.intraday: 'Intraday',
  CycleKind.postClose: 'Post-close',
  CycleKind.overnight: 'Overnight',
  CycleKind.manual: 'Manual',
};

CycleKind? _cycleKindFromName(String name) => switch (name) {
  'pre_open' => CycleKind.preOpen,
  'intraday' => CycleKind.intraday,
  'post_close' => CycleKind.postClose,
  'overnight' => CycleKind.overnight,
  'manual' => CycleKind.manual,
  _ => null,
};

/// Divider label from a cycle message whose first line is `Cycle <id> (<kind>).`
String cycleLabel(String text) {
  final first =
      text.split('\n').first.replaceAll(RegExp(r'^#+\s*'), '').trim();
  final kindName = RegExp(r'\(([a-z_]+)\)').firstMatch(first)?.group(1);
  final kind = kindName == null ? null : _cycleKindFromName(kindName);
  if (kind != null) return _cycleLabels[kind]!;
  var label = first;
  if (label.endsWith('.')) label = label.substring(0, label.length - 1);
  if (label.length > 80) label = label.substring(0, 80);
  return label.isEmpty ? 'Cycle' : label;
}

/// Which slot of the transcript a feed item came from.
enum FeedKind { cycle, user, assistant, helper, step, tools, decision }

/// One row of the agent feed: a transcript message, a Code Mode step pairing a
/// script with its result, a group of other tool calls, or a journal decision
/// placed where it was made.
sealed class FeedItem {
  String get key;
  FeedKind get kind;
}

class FeedMessage extends FeedItem {
  FeedMessage({required this.message});

  final ChatMessage message;

  @override
  String get key => message.id;

  @override
  FeedKind get kind => switch (message.role) {
    ChatRole.cycle => FeedKind.cycle,
    ChatRole.user => FeedKind.user,
    ChatRole.assistant => FeedKind.assistant,
    ChatRole.helper => FeedKind.helper,
    ChatRole.tool => FeedKind.tools,
  };
}

class FeedStep extends FeedItem {
  FeedStep({required this.code, this.result});

  final ChatMessage code;
  ChatMessage? result;

  @override
  String get key => code.id;

  @override
  FeedKind get kind => FeedKind.step;
}

class FeedTools extends FeedItem {
  FeedTools({required this.key, List<ChatMessage>? messages})
    : messages = messages ?? [];

  @override
  final String key;
  final List<ChatMessage> messages;

  @override
  FeedKind get kind => FeedKind.tools;
}

class FeedDecision extends FeedItem {
  FeedDecision({required this.entry});

  final JournalEntry entry;

  @override
  String get key => 'decision-${entry.id}';

  @override
  FeedKind get kind => FeedKind.decision;
}

bool isCode(ChatMessage m) =>
    m.role == ChatRole.tool && m.toolName == 'codemode' && m.code != null;

bool _isCodeResult(ChatMessage m) =>
    m.role == ChatRole.tool && m.toolName == 'codemode' && m.code == null;

/// Fold the transcript into render items: Code Mode steps pair script and
/// result; other tools group. A result attaches to the oldest script still
/// waiting for one, even when assistant text arrived in between.
List<FeedItem> buildItems(List<ChatMessage> messages) {
  final out = <FeedItem>[];
  final waiting = <FeedStep>[];
  for (final m in messages) {
    if (isCode(m)) {
      final step = FeedStep(code: m);
      out.add(step);
      waiting.add(step);
    } else if (_isCodeResult(m)) {
      if (waiting.isNotEmpty) {
        waiting.removeAt(0).result = m;
      } else {
        out.add(FeedStep(code: m.copyWith(code: ''), result: m));
      }
    } else if (m.role == ChatRole.tool) {
      final last = out.isEmpty ? null : out.last;
      if (last is FeedTools) {
        last.messages.add(m);
      } else {
        out.add(FeedTools(key: m.id, messages: [m]));
      }
    } else {
      out.add(FeedMessage(message: m));
    }
  }
  return out;
}

/// Display parts of a long-running helper's report: the helper's name, its
/// subagent role, and the body with the leading "treat this as untrusted data"
/// line stripped (it is delivery metadata, not report content).
class HelperReport {
  const HelperReport({
    required this.name,
    required this.role,
    required this.body,
  });

  final String name;
  final String? role;
  final String body;

  @override
  bool operator ==(Object other) =>
      other is HelperReport &&
      name == other.name &&
      role == other.role &&
      body == other.body;

  @override
  int get hashCode => Object.hash(name, role, body);
}

HelperReport helperReport(ChatMessage message) {
  final name =
      (message.helperName?.trim().isNotEmpty ?? false)
          ? message.helperName!.trim()
          : (message.agentRole?.trim().isNotEmpty ?? false)
              ? message.agentRole!.trim()
              : 'Helper';
  final role = message.agentRole?.trim();
  final lines = message.text.split('\n');
  final first = lines.isNotEmpty ? lines[0] : '';
  final isDeliveryHeader =
      lines.length > 1 &&
      RegExp(r'background helper', caseSensitive: false).hasMatch(first) &&
      RegExp(r'untrusted', caseSensitive: false).hasMatch(first);
  final body = isDeliveryHeader
      ? lines
            .sublist(1)
            .join('\n')
            .replaceAll(RegExp(r'^\s*\n'), '')
      : message.text;
  return HelperReport(
    name: name,
    role: (role == null || role.isEmpty) ? null : role,
    body: body,
  );
}

/// Key of the step that is still running: the newest script without a result.
String? liveStepKey(List<FeedItem> items) {
  for (var i = items.length - 1; i >= 0; i--) {
    final it = items[i];
    if (it is FeedStep && it.result == null) return it.key;
  }
  return null;
}

/// When the item happened, for placing journal decisions among the messages
/// around them.
int itemTime(FeedItem item) => switch (item) {
  FeedStep(code: final code) => code.at,
  FeedTools(messages: final messages) =>
    messages.isEmpty ? 0 : messages.first.at,
  FeedDecision(entry: final entry) => entry.at,
  FeedMessage(message: final message) => message.at,
};

/// Place the agent's journal decisions in the transcript where they were made,
/// oldest first. "none" entries and entries older than the loaded transcript
/// have no neighbours, so both are left out.
List<FeedItem> withDecisions(
  List<FeedItem> items,
  List<JournalEntry> entries,
) {
  if (items.isEmpty) return items.toList();
  final from = itemTime(items.first);
  final picks = entries
      .where((e) => e.action != JournalAction.none && e.at >= from)
      .toList()
    ..sort((a, b) => a.at.compareTo(b.at));
  final decisions = picks.map((entry) => FeedDecision(entry: entry)).toList();
  final out = <FeedItem>[];
  var d = 0;
  for (final item in items) {
    while (d < decisions.length && itemTime(decisions[d]) <= itemTime(item)) {
      out.add(decisions[d++]);
    }
    out.add(item);
  }
  while (d < decisions.length) {
    out.add(decisions[d++]);
  }
  return out;
}
