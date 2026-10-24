import {
  CSRF_HEADER,
  type ChatMessage,
  type ConnectResponse,
  type HistoryRange,
  type JournalEntry,
  type NoteContent,
  type NoteFile,
  type PriceHistory,
  type Skill,
  type SkillSummary,
  type SubagentRun,
  type OrderRecord,
  type ServerEvent,
  type Settings,
  type SettingsPatch,
  type StatusResponse,
} from "@rh/shared";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface EventHandlers {
  onEvent(event: ServerEvent): void;
  /** Fires on the first connect and on every reconnect. */
  onOpen(): void;
  onClose(): void;
}

export interface Api {
  status(): Promise<StatusResponse>;
  messages(limit?: number): Promise<ChatMessage[]>;
  sendMessage(text: string): Promise<void>;
  runCycle(): Promise<void>;
  journal(limit?: number): Promise<JournalEntry[]>;
  orders(limit?: number): Promise<OrderRecord[]>;
  approve(id: string): Promise<OrderRecord | void>;
  reject(id: string, reason?: string): Promise<OrderRecord | void>;
  settings(): Promise<Settings>;
  patchSettings(patch: SettingsPatch): Promise<Settings | void>;
  connectUrl(): Promise<ConnectResponse>;
  disconnect(): Promise<void>;
  subagents(): Promise<SubagentRun[]>;
  conversationMessages(id: string, limit?: number): Promise<ChatMessage[]>;
  skills(): Promise<SkillSummary[]>;
  skill(name: string): Promise<Skill>;
  notes(): Promise<NoteFile[]>;
  note(path: string): Promise<NoteContent>;
  history(symbol: string, range: HistoryRange): Promise<PriceHistory>;
  subscribe(handlers: EventHandlers): () => void;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") headers[CSRF_HEADER] = "1";
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the harness server");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) throw toError(res.status, data, text);
  return data as T;
}

function toError(status: number, data: unknown, text: string): ApiError {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const message =
    (typeof obj.error === "string" && obj.error) ||
    (typeof obj.message === "string" && obj.message) ||
    text.slice(0, 200) ||
    `Request failed (${status})`;
  return new ApiError(status, message);
}

function subscribeEvents(h: EventHandlers): () => void {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;

  const open = () => {
    source = new EventSource("/api/events");
    source.onopen = () => {
      attempt = 0;
      h.onOpen();
    };
    source.onmessage = (e) => {
      try {
        h.onEvent(JSON.parse(e.data) as ServerEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    source.onerror = () => {
      source?.close();
      source = null;
      h.onClose();
      if (stopped) return;
      const delay = Math.min(15_000, 1000 * 2 ** attempt++) + Math.random() * 400;
      timer = setTimeout(open, delay);
    };
  };
  open();

  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
}

export const realApi: Api = {
  status: () => request("GET", "/api/status"),
  messages: (limit = 200) => request("GET", `/api/messages?limit=${limit}`),
  sendMessage: (text) => request("POST", "/api/messages", { text }),
  runCycle: () => request("POST", "/api/cycles"),
  journal: (limit = 100) => request("GET", `/api/journal?limit=${limit}`),
  orders: (limit = 100) => request("GET", `/api/orders?limit=${limit}`),
  approve: (id) => request("POST", `/api/orders/${encodeURIComponent(id)}/approve`, {}),
  reject: (id, reason) =>
    request("POST", `/api/orders/${encodeURIComponent(id)}/reject`, reason ? { reason } : {}),
  settings: () => request("GET", "/api/settings"),
  patchSettings: (patch) => request("PATCH", "/api/settings", patch),
  connectUrl: () => request("GET", "/api/robinhood/connect"),
  disconnect: () => request("POST", "/api/robinhood/disconnect", {}),
  subagents: () => request("GET", "/api/subagents"),
  conversationMessages: (id, limit = 200) =>
    request("GET", `/api/conversations/${encodeURIComponent(id)}/messages?limit=${limit}`),
  skills: () => request("GET", "/api/skills"),
  skill: (name) => request("GET", `/api/skills/${encodeURIComponent(name)}`),
  notes: () => request("GET", "/api/notes"),
  note: (path) => request("GET", `/api/notes/${path.split("/").map(encodeURIComponent).join("/")}`),
  history: (symbol, range) =>
    request("GET", `/api/market/history?symbol=${encodeURIComponent(symbol)}&range=${range}`),
  subscribe: subscribeEvents,
};

/** The mock module is only reachable when VITE_MOCK_API=1 is set at build time; production bundles drop it. */
export async function loadApi(): Promise<Api> {
  if (import.meta.env.VITE_MOCK_API === "1") {
    const { createMockApi } = await import("./mock/index.ts");
    return createMockApi();
  }
  return realApi;
}
