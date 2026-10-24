import {
  CSRF_HEADER,
  type ChatMessage,
  type ConnectResponse,
  type JournalEntry,
  type OrderRecord,
  type ServerEvent,
  type Settings,
  type SettingsPatch,
  type StatusResponse,
} from "@rh/shared";

export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly issues: FieldIssue[];
  constructor(status: number, message: string, issues: FieldIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
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
  const raw = obj.issues ?? obj.errors;
  const issues: FieldIssue[] = Array.isArray(raw)
    ? raw
        .filter((i): i is { path?: unknown; message?: unknown } => !!i && typeof i === "object")
        .map((i) => ({
          path: Array.isArray(i.path) ? i.path.join(".") : String(i.path ?? ""),
          message: String(i.message ?? "Invalid value"),
        }))
    : [];
  const message =
    (typeof obj.error === "string" && obj.error) ||
    (typeof obj.message === "string" && obj.message) ||
    text.slice(0, 200) ||
    `Request failed (${status})`;
  return new ApiError(status, message, issues);
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
