import type {
  ChatMessage,
  JournalEntry,
  NoteFile,
  OrderRecord,
  ServerEvent,
  StatusResponse,
  SubagentRun,
  ToolCallSummary,
} from "@rh/shared";

/** A subagent's transcript, kept live from scoped `message`, `delta` and `calls` events. */
export interface Transcript {
  messages: ChatMessage[];
  draft: string;
  calls: ToolCallSummary[];
}

/** A chat message the user sent that the server has not committed yet. */
export interface OutboxItem {
  id: string;
  text: string;
  at: number;
  failed?: boolean;
}

export interface FeedState {
  status: StatusResponse | null;
  messages: ChatMessage[];
  journal: JournalEntry[];
  orders: OrderRecord[];
  /** Streaming assistant text for the in-flight turn. */
  draft: string;
  /** Live nested calls of the lead agent's running Code Mode script. */
  calls: ToolCallSummary[];
  /** Newest first. */
  subagents: SubagentRun[];
  transcripts: Record<string, Transcript>;
  notes: NoteFile[];
  outbox: OutboxItem[];
}

export const emptyTranscript = (): Transcript => ({ messages: [], draft: "", calls: [] });

export const emptyState = (): FeedState => ({
  status: null,
  messages: [],
  journal: [],
  orders: [],
  draft: "",
  calls: [],
  subagents: [],
  transcripts: {},
  notes: [],
  outbox: [],
});

/** Insert or replace by id, keeping `key` ascending (messages) or descending (journal, orders). */
export function upsert<T extends { id: string }>(
  list: readonly T[],
  item: T,
  key: (t: T) => number,
  order: "asc" | "desc",
): T[] {
  const next = list.filter((x) => x.id !== item.id);
  next.push(item);
  const sign = order === "asc" ? 1 : -1;
  next.sort((a, b) => sign * (key(a) - key(b)));
  return next;
}

export const upsertMessage = (l: readonly ChatMessage[], m: ChatMessage) =>
  upsert(l, m, (x) => x.at, "asc");
export const upsertJournal = (l: readonly JournalEntry[], e: JournalEntry) =>
  upsert(l, e, (x) => x.at, "desc");
export const upsertOrder = (l: readonly OrderRecord[], o: OrderRecord) =>
  upsert(l, o, (x) => x.createdAt, "desc");
export const upsertRun = (l: readonly SubagentRun[], r: SubagentRun) =>
  upsert(l, r, (x) => x.startedAt, "desc");

export function upsertNote(list: readonly NoteFile[], note: NoteFile): NoteFile[] {
  return [...list.filter((n) => n.path !== note.path), note].sort((a, b) => a.path.localeCompare(b.path));
}

/** A committed Code Mode result (or any assistant text) replaces the live calls of that turn. */
const endsLiveCalls = (m: ChatMessage) =>
  (m.role === "tool" && m.toolName === "codemode" && m.code === undefined) || m.role === "assistant";

/** Merge a fetched subagent transcript with whatever streamed in meanwhile. */
export function mergeTranscript(state: FeedState, id: string, fetched: readonly ChatMessage[]): FeedState {
  const cur = state.transcripts[id] ?? emptyTranscript();
  let messages = cur.messages;
  for (const m of fetched) messages = upsertMessage(messages, m);
  return { ...state, transcripts: { ...state.transcripts, [id]: { ...cur, messages } } };
}

export function addOutbox(state: FeedState, item: OutboxItem): FeedState {
  return { ...state, outbox: [...state.outbox, item] };
}

export function dropOutbox(state: FeedState, id: string): FeedState {
  return { ...state, outbox: state.outbox.filter((o) => o.id !== id) };
}

export function failOutbox(state: FeedState, id: string): FeedState {
  return { ...state, outbox: state.outbox.map((o) => (o.id === id ? { ...o, failed: true } : o)) };
}

function applyScoped(state: FeedState, id: string, event: ServerEvent): FeedState {
  const cur = state.transcripts[id] ?? emptyTranscript();
  let next: Transcript = cur;
  if (event.type === "message") {
    next = {
      messages: upsertMessage(cur.messages, event.message),
      draft: event.message.role === "assistant" ? "" : cur.draft,
      calls: endsLiveCalls(event.message) ? [] : cur.calls,
    };
  } else if (event.type === "delta") {
    next = { ...cur, draft: cur.draft + event.text };
  } else if (event.type === "calls") {
    next = { ...cur, calls: event.calls };
  }
  return { ...state, transcripts: { ...state.transcripts, [id]: next } };
}

/** Pure reducer for one SSE event. */
export function applyEvent(state: FeedState, event: ServerEvent): FeedState {
  if ((event.type === "message" || event.type === "delta" || event.type === "calls") && event.conversationId) {
    return applyScoped(state, event.conversationId, event);
  }
  switch (event.type) {
    case "status": {
      const idle = event.status.agent.state !== "running";
      return {
        ...state,
        status: event.status,
        draft: idle ? "" : state.draft,
        calls: idle ? [] : state.calls,
      };
    }
    case "message": {
      const m = event.message;
      const outbox =
        m.role === "user"
          ? (() => {
              const i = state.outbox.findIndex((o) => !o.failed && o.text.trim() === m.text.trim());
              return i < 0 ? state.outbox : state.outbox.filter((_, j) => j !== i);
            })()
          : state.outbox;
      return {
        ...state,
        messages: upsertMessage(state.messages, m),
        draft: m.role === "assistant" ? "" : state.draft,
        calls: endsLiveCalls(m) ? [] : state.calls,
        outbox,
      };
    }
    case "delta":
      return { ...state, draft: state.draft + event.text };
    case "calls":
      return { ...state, calls: event.calls };
    case "subagent":
      return { ...state, subagents: upsertRun(state.subagents, event.run) };
    case "note":
      return { ...state, notes: upsertNote(state.notes, event.note) };
    case "journal":
      return { ...state, journal: upsertJournal(state.journal, event.entry) };
    case "order":
      return { ...state, orders: upsertOrder(state.orders, event.order) };
    default:
      return state;
  }
}
