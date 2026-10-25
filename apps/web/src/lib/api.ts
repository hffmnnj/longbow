import {
  CSRF_HEADER,
  type ChatMessage,
  type AnalyticsRange,
  type ConnectResponse,
  type EquityHistory,
  type MarketOverview,
  type PerformanceSummary,
  type Report,
  type ReportKind,
  type ReportSummary,
  type SimRun,
  type SimRunConfig,
  type SimScenario,
  type SimSuite,
  type SimSuiteConfig,
  type Skill,
  type SkillSummary,
  type SubagentRun,
  type OrderRecord,
  type ServerEvent,
  type Settings,
  type SettingsPatch,
  type StatusResponse,
  type SymbolDetail,
  type HistoryRange,
  type JournalEntry,
  type NoteContent,
  type NoteFile,
  type PriceHistory,
  type PushSubscriptionInput,
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
  equity(range: AnalyticsRange): Promise<EquityHistory>;
  performance(): Promise<PerformanceSummary>;
  reports(kind?: ReportKind, limit?: number): Promise<ReportSummary[]>;
  report(id: string): Promise<Report>;
  marketOverview(): Promise<MarketOverview>;
  symbolDetail(symbol: string): Promise<SymbolDetail>;
  simRuns(): Promise<SimRun[]>;
  simRun(id: string): Promise<SimRun>;
  simStart(config: SimRunConfig): Promise<SimRun>;
  simStop(id: string): Promise<SimRun | void>;
  simScenarios(): Promise<SimScenario[]>;
  simSuites(): Promise<SimSuite[]>;
  simSuite(id: string): Promise<SimSuite>;
  simSuiteStart(config: SimSuiteConfig): Promise<SimSuite>;
  simSuiteStop(id: string): Promise<SimSuite | void>;
  simMessages(id: string, limit?: number, conversationId?: string): Promise<ChatMessage[]>;
  simJournal(id: string): Promise<JournalEntry[]>;
  simOrders(id: string): Promise<OrderRecord[]>;
  pushKey(): Promise<{ publicKey: string }>;
  pushSubscribe(sub: PushSubscriptionInput): Promise<void>;
  pushUnsubscribe(endpoint: string): Promise<void>;
  pushTest(): Promise<{ sent: number; removed: number }>;
  subscribe(handlers: EventHandlers): () => void;
}

/** Set by the service worker on a /api/status response it served from cache while offline. */
export const apiMeta = { statusCachedAt: null as number | null };

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
  if (path === "/api/status") {
    const at = Number(res.headers.get("x-harness-cached-at"));
    apiMeta.statusCachedAt = at > 0 ? at : null;
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
  equity: (range) => request("GET", `/api/analytics/equity?range=${range}`),
  performance: () => request("GET", "/api/analytics/performance"),
  reports: (kind, limit) => {
    const q = new URLSearchParams();
    if (kind) q.set("kind", kind);
    if (limit !== undefined) q.set("limit", String(limit));
    const s = q.toString();
    return request("GET", `/api/reports${s ? `?${s}` : ""}`);
  },
  report: (id) => request("GET", `/api/reports/${encodeURIComponent(id)}`),
  marketOverview: () => request("GET", "/api/market/overview"),
  symbolDetail: (symbol) => request("GET", `/api/symbols/${encodeURIComponent(symbol)}`),
  simRuns: () => request("GET", "/api/sim/runs"),
  simRun: (id) => request("GET", `/api/sim/runs/${encodeURIComponent(id)}`),
  simStart: (config) => request("POST", "/api/sim/runs", config),
  simStop: (id) => request("POST", `/api/sim/runs/${encodeURIComponent(id)}/stop`, {}),
  simScenarios: () => request("GET", "/api/sim/scenarios"),
  simSuites: () => request("GET", "/api/sim/suites"),
  simSuite: (id) => request("GET", `/api/sim/suites/${encodeURIComponent(id)}`),
  simSuiteStart: (config) => request("POST", "/api/sim/suites", config),
  simSuiteStop: (id) => request("POST", `/api/sim/suites/${encodeURIComponent(id)}/stop`, {}),
  simMessages: (id, limit = 200, conversationId) =>
    request(
      "GET",
      `/api/sim/runs/${encodeURIComponent(id)}/messages?limit=${limit}${conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : ""}`,
    ),
  simJournal: (id) => request("GET", `/api/sim/runs/${encodeURIComponent(id)}/journal`),
  simOrders: (id) => request("GET", `/api/sim/runs/${encodeURIComponent(id)}/orders`),
  pushKey: () => request("GET", "/api/push/key"),
  pushSubscribe: (sub) => request("POST", "/api/push/subscribe", sub),
  pushUnsubscribe: (endpoint) => request("POST", "/api/push/unsubscribe", { endpoint }),
  pushTest: () => request("POST", "/api/push/test", {}),
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
