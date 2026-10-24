import type { ChatMessage, JournalEntry, OrderRecord, ServerEvent, StatusResponse } from "@rh/shared";

export interface FeedState {
  status: StatusResponse | null;
  messages: ChatMessage[];
  journal: JournalEntry[];
  orders: OrderRecord[];
  /** Streaming assistant text for the in-flight turn. */
  draft: string;
}

export const emptyState = (): FeedState => ({
  status: null,
  messages: [],
  journal: [],
  orders: [],
  draft: "",
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

/** Pure reducer for one SSE event. */
export function applyEvent(state: FeedState, event: ServerEvent): FeedState {
  switch (event.type) {
    case "status": {
      const idle = event.status.agent.state !== "running";
      return { ...state, status: event.status, draft: idle ? "" : state.draft };
    }
    case "message": {
      const committed = event.message.role === "assistant";
      return {
        ...state,
        messages: upsertMessage(state.messages, event.message),
        draft: committed ? "" : state.draft,
      };
    }
    case "delta":
      return { ...state, draft: state.draft + event.text };
    case "journal":
      return { ...state, journal: upsertJournal(state.journal, event.entry) };
    case "order":
      return { ...state, orders: upsertOrder(state.orders, event.order) };
    default:
      return state;
  }
}
