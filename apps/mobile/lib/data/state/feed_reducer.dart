import 'package:longbow/models/models.dart';

/// Dart port of apps/web/src/lib/reducer.ts: pure functions over immutable
/// value classes. Screens read [FeedState] from the harness store; every
/// update builds a new instance with [copyWith].

/// A subagent's transcript, kept live from scoped `message`, `delta` and
/// `calls` events.
class Transcript {
  const Transcript({
    this.messages = const [],
    this.draft = '',
    this.calls = const [],
  });

  final List<ChatMessage> messages;
  final String draft;
  final List<ToolCallSummary> calls;

  Transcript copyWith({
    List<ChatMessage>? messages,
    String? draft,
    List<ToolCallSummary>? calls,
  }) {
    return Transcript(
      messages: messages ?? this.messages,
      draft: draft ?? this.draft,
      calls: calls ?? this.calls,
    );
  }
}

/// A chat message the user sent that the server has not committed yet.
class OutboxItem {
  const OutboxItem({required this.id, required this.text, required this.at, this.failed = false});

  final String id;
  final String text;
  final int at;
  final bool failed;

  OutboxItem copyWith({String? id, String? text, int? at, bool? failed}) {
    return OutboxItem(
      id: id ?? this.id,
      text: text ?? this.text,
      at: at ?? this.at,
      failed: failed ?? this.failed,
    );
  }
}

class FeedState {
  const FeedState({
    this.status,
    this.messages = const [],
    this.journal = const [],
    this.orders = const [],
    this.draft = '',
    this.calls = const [],
    this.subagents = const [],
    this.transcripts = const {},
    this.notes = const [],
    this.outbox = const [],
    this.reports = const [],
  });

  final StatusResponse? status;
  final List<ChatMessage> messages;
  final List<JournalEntry> journal;
  final List<OrderRecord> orders;

  /// Streaming assistant text for the in-flight turn.
  final String draft;

  /// Live nested calls of the lead agent's running Code Mode script.
  final List<ToolCallSummary> calls;

  /// Newest first.
  final List<SubagentRun> subagents;
  final Map<String, Transcript> transcripts;
  final List<NoteFile> notes;
  final List<OutboxItem> outbox;

  /// Published reports, newest first.
  final List<ReportSummary> reports;

  FeedState copyWith({
    StatusResponse? Function()? status,
    List<ChatMessage>? messages,
    List<JournalEntry>? journal,
    List<OrderRecord>? orders,
    String? draft,
    List<ToolCallSummary>? calls,
    List<SubagentRun>? subagents,
    Map<String, Transcript>? transcripts,
    List<NoteFile>? notes,
    List<OutboxItem>? outbox,
    List<ReportSummary>? reports,
  }) {
    return FeedState(
      status: status != null ? status() : this.status,
      messages: messages ?? this.messages,
      journal: journal ?? this.journal,
      orders: orders ?? this.orders,
      draft: draft ?? this.draft,
      calls: calls ?? this.calls,
      subagents: subagents ?? this.subagents,
      transcripts: transcripts ?? this.transcripts,
      notes: notes ?? this.notes,
      outbox: outbox ?? this.outbox,
      reports: reports ?? this.reports,
    );
  }
}

const Transcript emptyTranscript = Transcript();

FeedState emptyState() => const FeedState();

/// Insert or replace by id, keeping [key] ascending (messages) or descending
/// (journal, orders).
List<T> upsert<T extends Object>(
  List<T> list,
  T item,
  String Function(T) idOf,
  num Function(T) keyOf,
  bool ascending,
) {
  final next = list.where((x) => idOf(x) != idOf(item)).toList();
  next.add(item);
  next.sort((a, b) {
    final cmp = keyOf(a).compareTo(keyOf(b));
    return ascending ? cmp : -cmp;
  });
  return next;
}

List<ChatMessage> upsertMessage(List<ChatMessage> list, ChatMessage message) =>
    upsert(list, message, (m) => m.id, (m) => m.at, true);

List<JournalEntry> upsertJournal(List<JournalEntry> list, JournalEntry entry) =>
    upsert(list, entry, (e) => e.id, (e) => e.at, false);

List<OrderRecord> upsertOrder(List<OrderRecord> list, OrderRecord order) =>
    upsert(list, order, (o) => o.id, (o) => o.createdAt, false);

List<SubagentRun> upsertRun(List<SubagentRun> list, SubagentRun run) =>
    upsert(list, run, (r) => r.id, (r) => r.startedAt, false);

List<ReportSummary> upsertReport(
        List<ReportSummary> list, ReportSummary report) =>
    upsert(list, report, (r) => r.id, (r) => r.at, false);

List<NoteFile> upsertNote(List<NoteFile> list, NoteFile note) {
  final next = list.where((n) => n.path != note.path).toList()..add(note);
  next.sort((a, b) => a.path.compareTo(b.path));
  return next;
}

/// A committed Code Mode result (or any assistant text) replaces the live
/// calls of that turn.
bool endsLiveCalls(ChatMessage message) =>
    (message.role == ChatRole.tool &&
        message.toolName == 'codemode' &&
        message.code == null) ||
    message.role == ChatRole.assistant;

/// Merge a fetched subagent transcript with whatever streamed in meanwhile.
FeedState mergeTranscript(
    FeedState state, String id, List<ChatMessage> fetched) {
  final current = state.transcripts[id] ?? emptyTranscript;
  var messages = current.messages;
  for (final message in fetched) {
    messages = upsertMessage(messages, message);
  }
  return state.copyWith(
    transcripts: {...state.transcripts, id: current.copyWith(messages: messages)},
  );
}

FeedState addOutbox(FeedState state, OutboxItem item) =>
    state.copyWith(outbox: [...state.outbox, item]);

FeedState dropOutbox(FeedState state, String id) =>
    state.copyWith(outbox: state.outbox.where((o) => o.id != id).toList());

FeedState failOutbox(FeedState state, String id) => state.copyWith(
    outbox: state.outbox
        .map((o) => o.id == id ? o.copyWith(failed: true) : o)
        .toList());

/// The sim run an event belongs to, or null for live-account events.
String? simRunIdOf(ServerEvent event) => switch (event) {
      MessageEvent(:final simRunId) => simRunId,
      DeltaEvent(:final simRunId) => simRunId,
      CallsEvent(:final simRunId) => simRunId,
      SubagentEvent(:final simRunId) => simRunId,
      JournalEvent(:final simRunId) => simRunId,
      OrderEvent(:final simRunId) => simRunId,
      NoteEvent(:final simRunId) => simRunId,
      ReportEvent(:final simRunId) => simRunId,
      SimEvent() || SimSuiteEvent() || StatusEvent() => null,
    };

FeedState _applyScoped(FeedState state, String id, ServerEvent event) {
  final current = state.transcripts[id] ?? emptyTranscript;
  final Transcript next;
  if (event is MessageEvent) {
    next = Transcript(
      messages: upsertMessage(current.messages, event.message),
      draft: event.message.role == ChatRole.assistant ? '' : current.draft,
      calls: endsLiveCalls(event.message) ? const [] : current.calls,
    );
  } else if (event is DeltaEvent) {
    next = current.copyWith(draft: current.draft + event.text);
  } else if (event is CallsEvent) {
    next = current.copyWith(calls: event.calls);
  } else {
    return state;
  }
  return state.copyWith(
      transcripts: {...state.transcripts, id: next});
}

/// Pure reducer for one SSE event. Simulation events belong to the lab store;
/// the live feed never sees them.
FeedState applyEvent(FeedState state, ServerEvent event) {
  if (event is SimEvent || event is SimSuiteEvent || simRunIdOf(event) != null) {
    return state;
  }
  final conversationId = switch (event) {
    MessageEvent(:final conversationId) => conversationId,
    DeltaEvent(:final conversationId) => conversationId,
    CallsEvent(:final conversationId) => conversationId,
    _ => null,
  };
  if (conversationId != null &&
      (event is MessageEvent ||
          event is DeltaEvent ||
          event is CallsEvent)) {
    return _applyScoped(state, conversationId, event);
  }
  switch (event) {
    case StatusEvent(:final status):
      final idle = status.agent.state != AgentState.running;
      return state.copyWith(
        status: () => status,
        draft: idle ? '' : state.draft,
        calls: idle ? const [] : state.calls,
      );
    case MessageEvent(:final message):
      final List<OutboxItem> outbox;
      if (message.role == ChatRole.user) {
        final index = state.outbox.indexWhere((o) =>
            !o.failed && o.text.trim() == message.text.trim());
        if (index < 0) {
          outbox = state.outbox;
        } else {
          final next = List<OutboxItem>.of(state.outbox);
          next.removeAt(index);
          outbox = next;
        }
      } else {
        outbox = state.outbox;
      }
      return state.copyWith(
        messages: upsertMessage(state.messages, message),
        draft: message.role == ChatRole.assistant ? '' : state.draft,
        calls: endsLiveCalls(message) ? const [] : state.calls,
        outbox: outbox,
      );
    case DeltaEvent(:final text):
      return state.copyWith(draft: state.draft + text);
    case CallsEvent(:final calls):
      return state.copyWith(calls: calls);
    case SubagentEvent(:final run):
      return state.copyWith(subagents: upsertRun(state.subagents, run));
    case NoteEvent(:final note):
      return state.copyWith(notes: upsertNote(state.notes, note));
    case JournalEvent(:final entry):
      return state.copyWith(journal: upsertJournal(state.journal, entry));
    case OrderEvent(:final order):
      return state.copyWith(orders: upsertOrder(state.orders, order));
    case ReportEvent(:final report):
      return state.copyWith(reports: upsertReport(state.reports, report));
    case SimEvent() || SimSuiteEvent():
      return state;
  }
}
